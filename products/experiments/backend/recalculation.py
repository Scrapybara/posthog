"""Service layer for experiment metrics recalculation.

Module-level free functions (not methods on ExperimentService) so the API view can compose them directly:

- ``request_recalculation`` — idempotent create: returns the active run if one exists, else creates a pending job.
- ``get_latest_recalculation`` — most recent recalc row for an experiment, or ``None``.
- ``get_run_results`` — read-back of per-metric results for a specific run, scoped by recomputing each metric's
  per-run recalc fingerprint (no FK on ExperimentMetricResult; the scoping key lives entirely on the job row +
  the run id).
"""

from datetime import timedelta
from uuid import UUID

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from prometheus_client import Counter
from rest_framework.exceptions import ValidationError

from posthog.models.scoping import team_scope
from posthog.models.user import User

from products.experiments.backend.models.experiment import (
    Experiment,
    ExperimentMetricResult,
    ExperimentMetricsRecalculation,
)
from products.experiments.backend.result_serialization import strip_step_sessions
from products.experiments.backend.temporal.recalculation_logic import discover_experiment_metrics

# How long an active (PENDING/IN_PROGRESS) row blocks new recalculations. Beyond this, the row is treated as
# stale and a fresh recalc is allowed. Sized to be safely above the workflow's worst-case end-to-end runtime
# (discovery retries + per-metric calc retries + progress activities) so a legitimately-slow run can finish
# without being clobbered, but tight enough that an operator can recover within an hour if the workflow
# never started (Temporal connect failure, transient infra issue, etc.). See the rollback in views.py for the
# happy-path failure handling; this TTL is the defense-in-depth backstop if that rollback itself fails.
_STALE_RECALC_THRESHOLD = timedelta(minutes=30)

# `is_existing=True` reuse path — counts how often the idempotency guard saves us a workflow start.
# A sustained climb here without a matching climb in requests is the signal the frontend is double-posting.
_recalculation_reuse_counter = Counter(
    "experiment_metrics_recalculation_existing_run_reused",
    "POST requests that returned an existing active run instead of creating a new one (idempotent reuse).",
)
# Fires whenever the 30-min staleness threshold marks a PENDING/IN_PROGRESS row FAILED so the experiment
# can recalculate again. A sustained climb is a leading indicator of Temporal connect failures or the
# rollback path in views.py itself failing.
_recalculation_stale_cleanup_counter = Counter(
    "experiment_metrics_recalculation_stale_rows_cleaned",
    "Stale recalc rows force-failed to release the per-experiment uniqueness constraint.",
)


def _derive_counters(recalc: ExperimentMetricsRecalculation, results: list[dict] | None = None) -> tuple[int, int]:
    """Counters are not stored on the row (PR1 contract): they're derived on read from result rows + errors.

    `completed_metrics` = ExperimentMetricResult rows with status=COMPLETED for this run's fingerprints.
    `failed_metrics`    = ExperimentMetricResult rows with status=FAILED + metric_errors keys that never made
                          it to a result row (discovery-step failures).

    Accepts an optional pre-computed `results` list to avoid recomputing fingerprints on the GET path where
    the same list is also surfaced to the client.

    Inherits the fingerprint-divergence hazard from `get_run_results`: `completed_metrics` can silently drop
    if experiment fields that feed the fingerprint (start_date, exposure_criteria, stats method,
    only_count_matured_users) change between the workflow's writes and this read. `failed_metrics` is partly
    immune because discovery-step failures come from `metric_errors` (stored on the row), not from result rows.
    """
    rows = results if results is not None else get_run_results(recalc)
    completed = sum(1 for r in rows if r["status"] == ExperimentMetricResult.Status.COMPLETED)
    failed_in_rows = sum(1 for r in rows if r["status"] == ExperimentMetricResult.Status.FAILED)
    uuids_with_row = {r["metric_uuid"] for r in rows}
    discovery_only_failures = sum(1 for uuid in (recalc.metric_errors or {}) if uuid not in uuids_with_row)
    return completed, failed_in_rows + discovery_only_failures


def build_job_payload(
    recalc: ExperimentMetricsRecalculation,
    *,
    is_existing: bool | None = None,
    results: list[dict] | None = None,
) -> dict:
    """Shape a recalc row + derived counters as a dict the serializer can re-serialize.

    Returns model-native values (datetimes, ints, dicts) — DRF handles the wire format. The POST path passes
    `is_existing` to signal whether the workflow needs starting; the GET paths pass `results` so the same row
    list backs both the derived counters and the response's `results` field (no duplicate fingerprint work).
    """
    completed_metrics, failed_metrics = _derive_counters(recalc, results=results)
    payload: dict = {
        "id": str(recalc.id),
        "experiment_id": recalc.experiment_id,
        "status": recalc.status,
        "total_metrics": recalc.total_metrics,
        "completed_metrics": completed_metrics,
        "failed_metrics": failed_metrics,
        "metric_errors": recalc.metric_errors,
        "trigger": recalc.trigger,
        "created_at": recalc.created_at,
        "started_at": recalc.started_at,
        "completed_at": recalc.completed_at,
    }
    if is_existing is not None:
        payload["is_existing"] = is_existing
    return payload


def request_recalculation(experiment: Experiment, user: User, trigger: str = "manual") -> dict:
    """Create an idempotent batch recalculation request for all experiment metrics.

    If an active (pending or in_progress) run already exists for this experiment, returns the existing run's
    serialized payload with ``is_existing=True`` — the caller should NOT start a new workflow in that case.
    Otherwise creates a fresh pending row.
    """
    if not experiment.is_launched:
        raise ValidationError("Cannot recalculate metrics for experiment that hasn't started")

    with team_scope(experiment.team_id, canonical=True), transaction.atomic():
        # Serialize concurrent POSTs for this experiment by locking the Experiment row up front. Without this,
        # two simultaneous POSTs (double-click, retry storm, two tabs) both see no active recalc row and both
        # reach .create(); the second hits the unique_active_metrics_recalculation_per_experiment constraint
        # and returns HTTP 500. Locking the Experiment row queues the second POST behind the first, which
        # then sees the freshly-created row in its lookup and returns is_existing=True cleanly.
        Experiment.objects.select_for_update().filter(id=experiment.id).first()

        # Activity-aware staleness: PENDING rows anchor on created_at (workflow never reached its start
        # activity); IN_PROGRESS rows anchor on started_at (workflow began executing then stalled). A row past
        # the threshold is treated as dead and skipped, so a fresh recalc can start. Without this, a PENDING
        # row left orphaned by a Temporal-connect failure that also lost its rollback UPDATE would permanently
        # lock the experiment out of recalculations.
        threshold = timezone.now() - _STALE_RECALC_THRESHOLD
        existing = (
            ExperimentMetricsRecalculation.objects.filter(experiment=experiment)
            .filter(
                Q(status=ExperimentMetricsRecalculation.Status.PENDING, created_at__gte=threshold)
                | Q(status=ExperimentMetricsRecalculation.Status.IN_PROGRESS, started_at__gte=threshold)
            )
            .first()
        )
        if existing:
            _recalculation_reuse_counter.inc()
            return build_job_payload(existing, is_existing=True)

        # No fresh active row, but stale tombstones might still hold the per-experiment uniqueness constraint
        # (unique_active_metrics_recalculation_per_experiment). Mark them FAILED so the constraint releases
        # and the new row can land. Status reflects reality — these workflows are not coming back.
        cleaned_count = ExperimentMetricsRecalculation.objects.filter(
            experiment=experiment,
            status__in=[
                ExperimentMetricsRecalculation.Status.PENDING,
                ExperimentMetricsRecalculation.Status.IN_PROGRESS,
            ],
        ).update(status=ExperimentMetricsRecalculation.Status.FAILED, completed_at=timezone.now())
        if cleaned_count:
            _recalculation_stale_cleanup_counter.inc(cleaned_count)

        # Set total_metrics up front from the experiment definition so the client can show progress
        # ("N of M") immediately, before the workflow's discovery activity confirms the same count.
        metrics = discover_experiment_metrics(experiment)
        recalc = ExperimentMetricsRecalculation.objects.create(
            team=experiment.team,
            experiment=experiment,
            trigger=trigger,
            status=ExperimentMetricsRecalculation.Status.PENDING,
            created_by=user,
            total_metrics=len(metrics),
            metric_uuids=[m.metric_uuid for m in metrics],
        )
        return build_job_payload(recalc, is_existing=False)


def get_latest_recalculation(experiment: Experiment) -> ExperimentMetricsRecalculation | None:
    """Most recent successfully-completed recalculation for an experiment, or None.

    Powers ``GET /metrics_recalculation/latest``: the frontend renders cached results from the last good run.
    Runs that are pending/in_progress/failed are NOT returned — the client tracks those separately by id.
    """
    with team_scope(experiment.team_id, canonical=True):
        return (
            ExperimentMetricsRecalculation.objects.filter(
                team=experiment.team,
                experiment=experiment,
                status=ExperimentMetricsRecalculation.Status.COMPLETED,
            )
            .order_by("-created_at")
            .first()
        )


def get_recalculation_by_id(experiment: Experiment, recalculation_id: str) -> ExperimentMetricsRecalculation | None:
    """Return the recalculation row for ``recalculation_id`` if it belongs to ``experiment``, else None.

    Enforces experiment scoping so the id-based GET cannot leak rows from a different experiment in the same team.
    Returns None for a malformed UUID rather than raising, so the calling view can answer with a clean 404.
    """
    try:
        uuid_value = UUID(recalculation_id)
    except (ValueError, TypeError):
        return None
    with team_scope(experiment.team_id, canonical=True):
        return ExperimentMetricsRecalculation.objects.filter(
            team=experiment.team, experiment=experiment, id=uuid_value
        ).first()


def get_run_results(recalc: ExperimentMetricsRecalculation) -> list[dict]:
    """Return the ExperimentMetricResult rows that belong to THIS run.

    Scopes by the run's stored metric UUIDs and query_to. The result table is unique on
    ``(experiment, metric_uuid, query_to)``, so this survives later experiment config edits
    that would otherwise change recomputed fingerprints.
    """
    metric_uuids = recalc.metric_uuids or []
    if not metric_uuids or recalc.query_to is None:
        return []

    rows = ExperimentMetricResult.objects.filter(
        experiment=recalc.experiment,
        metric_uuid__in=metric_uuids,
        query_to=recalc.query_to,
    )
    return [
        {
            "metric_uuid": row.metric_uuid,
            "status": row.status,
            "result": strip_step_sessions(row.result),
            "error_message": row.error_message,
        }
        for row in rows
    ]
