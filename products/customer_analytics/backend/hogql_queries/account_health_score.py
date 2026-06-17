import json
import math
import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal, TypedDict
from zoneinfo import ZoneInfo

from django.core.cache import cache
from django.core.exceptions import ObjectDoesNotExist
from django.utils import timezone

from posthog.schema import HogQLQueryModifiers

from posthog.hogql import ast
from posthog.hogql.parser import parse_select
from posthog.hogql.query import execute_hogql_query
from posthog.hogql.timings import HogQLTimings

from posthog.cdp.filters import hog_function_filters_to_expr
from posthog.models.team import Team
from posthog.models.user import User

from products.actions.backend.models.action import Action
from products.customer_analytics.backend.constants import DEFAULT_ACTIVITY_EVENT
from products.customer_analytics.backend.models.team_customer_analytics_config import TeamCustomerAnalyticsConfig

ACCOUNT_HEALTH_SCORE_COLUMN = "health_score"
ACCOUNT_HEALTH_SCORE_LOOKBACK_DAYS = 30
ACCOUNT_HEALTH_BASELINE_CACHE_TTL_SECONDS = 60 * 60

AccountHealthStatus = Literal["healthy", "neutral", "at_risk", "no_data"]


class AccountHealthFactor(TypedDict):
    key: str
    label: str
    value: float | int | str | None
    previousValue: float | int | str | None
    score: int | None
    weight: float
    description: str
    reason: str | None


class AccountHealthScore(TypedDict):
    score: int | None
    status: AccountHealthStatus
    lookbackDays: int
    activityEvent: str
    factors: list[AccountHealthFactor]
    noDataReason: str | None
    lastActivityAt: str | None


@dataclass(frozen=True)
class AccountActivityMetrics:
    current_count: float
    previous_count: float
    active_users: float
    active_days: float
    last_activity_at: datetime | None


@dataclass(frozen=True)
class AccountHealthBaseline:
    p90_activity_count: float
    p90_active_users: float


def no_data_health_score(
    reason: str, activity_event: str = "Activity", lookback_days: int = ACCOUNT_HEALTH_SCORE_LOOKBACK_DAYS
) -> AccountHealthScore:
    return {
        "score": None,
        "status": "no_data",
        "lookbackDays": lookback_days,
        "activityEvent": activity_event,
        "factors": [],
        "noDataReason": reason,
        "lastActivityAt": None,
    }


def score_account_health(
    metrics: AccountActivityMetrics,
    baseline: AccountHealthBaseline,
    *,
    activity_event: str,
    date_to: datetime,
    lookback_days: int = ACCOUNT_HEALTH_SCORE_LOOKBACK_DAYS,
) -> AccountHealthScore:
    if metrics.current_count == 0 and metrics.previous_count == 0:
        return no_data_health_score(
            f"No {activity_event} activity in the current or previous {lookback_days}-day window.",
            activity_event,
            lookback_days,
        )

    factors: list[AccountHealthFactor] = [
        _factor(
            key="activity",
            label="Activity volume",
            value=metrics.current_count,
            previous_value=metrics.previous_count,
            score=_normalize_against_baseline(metrics.current_count, baseline.p90_activity_count),
            weight=0.35,
            description=(
                f"{activity_event} events in the last {lookback_days} days, normalized against the team's active-account p90."
            ),
        ),
        _factor(
            key="active_users",
            label="Active users",
            value=metrics.active_users,
            previous_value=None,
            score=_normalize_against_baseline(metrics.active_users, baseline.p90_active_users),
            weight=0.25,
            description=f"Distinct users with {activity_event} activity, normalized against the team's active-account p90.",
        ),
        _factor(
            key="frequency",
            label="Active days",
            value=metrics.active_days,
            previous_value=None,
            score=_normalize_against_baseline(metrics.active_days, lookback_days),
            weight=0.2,
            description=f"Days with {activity_event} activity during the {lookback_days}-day window.",
        ),
        _factor(
            key="recency",
            label="Recency",
            value=_days_since(metrics.last_activity_at, date_to) if metrics.last_activity_at else None,
            previous_value=None,
            score=_recency_score(metrics.last_activity_at, date_to, lookback_days),
            weight=0.1,
            description=f"How recently this account had {activity_event} activity.",
        ),
        _factor(
            key="trend",
            label="Trend",
            value=metrics.current_count,
            previous_value=metrics.previous_count,
            score=_trend_score(metrics.current_count, metrics.previous_count),
            weight=0.1,
            description=f"Current {lookback_days}-day activity compared with the previous {lookback_days} days.",
            reason="No previous activity to compare." if metrics.previous_count == 0 else None,
        ),
    ]

    scored_factors = [factor for factor in factors if factor["score"] is not None]
    if not scored_factors:
        return no_data_health_score(
            f"Not enough {activity_event} activity to calculate a health score.",
            activity_event,
            lookback_days,
        )

    total_weight = sum(factor["weight"] for factor in scored_factors)
    score = round(sum((factor["score"] or 0) * factor["weight"] for factor in scored_factors) / total_weight)

    return {
        "score": score,
        "status": _status_for_score(score),
        "lookbackDays": lookback_days,
        "activityEvent": activity_event,
        "factors": factors,
        "noDataReason": None,
        "lastActivityAt": metrics.last_activity_at.isoformat() if metrics.last_activity_at else None,
    }


def _factor(
    *,
    key: str,
    label: str,
    value: float | int | str | None,
    previous_value: float | int | str | None,
    score: int | None,
    weight: float,
    description: str,
    reason: str | None = None,
) -> AccountHealthFactor:
    return {
        "key": key,
        "label": label,
        "value": value,
        "previousValue": previous_value,
        "score": score,
        "weight": weight,
        "description": description,
        "reason": reason,
    }


def _normalize_against_baseline(value: float, baseline: float) -> int | None:
    if baseline <= 0:
        return None
    return round(min(max(value, 0) / baseline, 1) * 100)


def _trend_score(current_count: float, previous_count: float) -> int | None:
    if previous_count == 0:
        return None
    return round(min(max(current_count, 0) / previous_count, 1) * 100)


def _recency_score(last_activity_at: datetime | None, date_to: datetime, lookback_days: int) -> int | None:
    if last_activity_at is None:
        return None
    days_since = _days_since(last_activity_at, date_to)
    return round(max(0, min(1, (lookback_days - days_since) / lookback_days)) * 100)


def _days_since(last_activity_at: datetime, date_to: datetime) -> float:
    if timezone.is_naive(last_activity_at):
        last_activity_at = timezone.make_aware(last_activity_at, ZoneInfo("UTC"))
    if timezone.is_naive(date_to):
        date_to = timezone.make_aware(date_to, ZoneInfo("UTC"))
    return max((date_to - last_activity_at).total_seconds() / 86400, 0)


def _status_for_score(score: int) -> AccountHealthStatus:
    if score >= 75:
        return "healthy"
    if score >= 40:
        return "neutral"
    return "at_risk"


def _activity_event_to_filters(activity_event: dict[str, Any]) -> dict[str, Any] | None:
    kind = activity_event.get("kind")
    if kind == "EventsNode":
        event_filter: dict[str, Any] = {
            "id": activity_event.get("event"),
            "name": activity_event.get("name") or activity_event.get("event") or "All events",
            "type": "events",
            "order": 0,
        }
        if activity_event.get("properties"):
            event_filter["properties"] = activity_event["properties"]
        return {"events": [event_filter]}
    if kind == "ActionsNode":
        action_filter = {
            "id": activity_event.get("id"),
            "name": activity_event.get("name") or str(activity_event.get("id")),
            "type": "actions",
            "order": 0,
        }
        if activity_event.get("properties"):
            action_filter["properties"] = activity_event["properties"]
        return {"actions": [action_filter]}
    return None


def _activity_event_label(activity_event: dict[str, Any]) -> str:
    raw_name = activity_event.get("name") or activity_event.get("event")
    if isinstance(raw_name, str) and raw_name:
        return raw_name
    return "Activity"


def _baseline_cache_key(
    *,
    team_id: int,
    group_type_index: int,
    activity_event: dict[str, Any],
    actions: dict[int, Action],
    date_to: datetime,
    lookback_days: int,
) -> str:
    if timezone.is_naive(date_to):
        date_to = timezone.make_aware(date_to, ZoneInfo("UTC"))
    cache_payload: dict[str, Any] = {"activity_event": activity_event}
    if actions:
        cache_payload["actions"] = [
            {"id": action_id, "updated_at": actions[action_id].updated_at} for action_id in sorted(actions)
        ]
    event_hash = hashlib.sha256(
        json.dumps(cache_payload, sort_keys=True, default=str, separators=(",", ":")).encode()
    ).hexdigest()[:16]
    bucket = date_to.astimezone(ZoneInfo("UTC")).strftime("%Y%m%d%H")
    return f"customer_analytics:account_health_baseline:v1:{team_id}:{group_type_index}:{lookback_days}:{bucket}:{event_hash}"


class AccountHealthScoreCalculator:
    def __init__(
        self,
        *,
        team: Team,
        user: User | None,
        timings: HogQLTimings | None = None,
        modifiers: HogQLQueryModifiers | None = None,
    ) -> None:
        self.team = team
        self.user = user
        self.timings = timings
        self.modifiers = modifiers

    def score_accounts(self, external_ids_by_account_id: dict[str, str | None]) -> dict[str, AccountHealthScore]:
        config = self._config()
        activity_event = self._activity_event(config)
        activity_label = _activity_event_label(activity_event)

        group_type_index = self._account_group_type_index(config)
        if group_type_index is None:
            return {
                account_id: no_data_health_score(
                    "Customer analytics is not connected to an account group type.",
                    activity_label,
                )
                for account_id in external_ids_by_account_id
            }

        filters = _activity_event_to_filters(activity_event)
        if filters is None:
            return {
                account_id: no_data_health_score(
                    "The configured activity source is not supported by health scoring yet.",
                    activity_label,
                )
                for account_id in external_ids_by_account_id
            }

        actions = self._actions_for_activity_event(activity_event)
        if actions is None:
            return {
                account_id: no_data_health_score(
                    "The configured activity source is no longer available.",
                    activity_label,
                )
                for account_id in external_ids_by_account_id
            }

        accounts_with_external_ids = {
            account_id: external_id
            for account_id, external_id in external_ids_by_account_id.items()
            if isinstance(external_id, str) and external_id
        }
        scores: dict[str, AccountHealthScore] = {
            account_id: no_data_health_score("This account has no external ID.", activity_label)
            for account_id, external_id in external_ids_by_account_id.items()
            if not external_id
        }
        if not accounts_with_external_ids:
            return scores

        date_to = timezone.now()
        date_from = date_to - timedelta(days=ACCOUNT_HEALTH_SCORE_LOOKBACK_DAYS)
        previous_date_from = date_to - timedelta(days=ACCOUNT_HEALTH_SCORE_LOOKBACK_DAYS * 2)
        activity_filter = hog_function_filters_to_expr(filters, self.team, actions)

        baseline = self._load_baseline(
            group_type_index=group_type_index,
            date_from=date_from,
            date_to=date_to,
            activity_filter=activity_filter,
            cache_key=_baseline_cache_key(
                team_id=self.team.id,
                group_type_index=group_type_index,
                activity_event=activity_event,
                actions=actions,
                date_to=date_to,
                lookback_days=ACCOUNT_HEALTH_SCORE_LOOKBACK_DAYS,
            ),
        )
        metrics_by_external_id = self._load_account_metrics(
            group_type_index=group_type_index,
            group_keys=list(accounts_with_external_ids.values()),
            date_from=date_from,
            previous_date_from=previous_date_from,
            date_to=date_to,
            activity_filter=activity_filter,
        )

        for account_id, external_id in accounts_with_external_ids.items():
            metrics = metrics_by_external_id.get(external_id)
            if metrics is None:
                scores[account_id] = no_data_health_score(
                    f"No {activity_label} activity in the current or previous {ACCOUNT_HEALTH_SCORE_LOOKBACK_DAYS}-day window.",
                    activity_label,
                )
                continue
            scores[account_id] = score_account_health(
                metrics,
                baseline,
                activity_event=activity_label,
                date_to=date_to,
            )
        return scores

    def _account_group_type_index(self, config: TeamCustomerAnalyticsConfig | None) -> int | None:
        if config is None:
            return None
        index = config.account_group_type_index
        return index if isinstance(index, int) and 0 <= index <= 4 else None

    def _activity_event(self, config: TeamCustomerAnalyticsConfig | None) -> dict[str, Any]:
        if config is None:
            return DEFAULT_ACTIVITY_EVENT
        event = config.activity_event
        return event if isinstance(event, dict) and event else DEFAULT_ACTIVITY_EVENT

    def _actions_for_activity_event(self, activity_event: dict[str, Any]) -> dict[int, Action] | None:
        if activity_event.get("kind") != "ActionsNode":
            return {}
        try:
            action_id = int(activity_event["id"])
        except (KeyError, TypeError, ValueError):
            return None
        try:
            action = Action.objects.get(id=action_id, team__project_id=self.team.project_id, deleted=False)
        except ObjectDoesNotExist:
            return None
        return {action_id: action}

    def _config(self) -> TeamCustomerAnalyticsConfig | None:
        try:
            return TeamCustomerAnalyticsConfig.objects.get(team_id=self.team.id)
        except ObjectDoesNotExist:
            return None

    def _load_baseline(
        self,
        *,
        group_type_index: int,
        date_from: datetime,
        date_to: datetime,
        activity_filter: ast.Expr,
        cache_key: str,
    ) -> AccountHealthBaseline:
        cached = cache.get(cache_key)
        if isinstance(cached, dict):
            return AccountHealthBaseline(
                p90_activity_count=_read_float(cached.get("p90_activity_count")),
                p90_active_users=_read_float(cached.get("p90_active_users")),
            )

        group_expr = f"toString(e.$group_{group_type_index})"
        query = parse_select(
            f"""
            SELECT
                quantileExact(0.9)(current_count) AS p90_activity_count,
                quantileExact(0.9)(active_users) AS p90_active_users
            FROM (
                SELECT
                    {group_expr} AS group_key,
                    count() AS current_count,
                    uniq(e.person_id) AS active_users
                FROM events AS e
                WHERE e.timestamp >= {{date_from}}
                  AND e.timestamp < {{date_to}}
                  AND notEmpty({group_expr})
                  AND {{activity_filter}}
                GROUP BY group_key
            )
            """,
            {
                "date_from": ast.Constant(value=date_from),
                "date_to": ast.Constant(value=date_to),
                "activity_filter": activity_filter,
            },
        )
        response = execute_hogql_query(
            query_type="AccountsHealthBaselineQuery",
            query=query,
            team=self.team,
            user=self.user,
            timings=self.timings,
            modifiers=self.modifiers,
        )
        row = response.results[0] if response.results else []
        baseline = AccountHealthBaseline(
            p90_activity_count=_read_float(row[0] if row else 0),
            p90_active_users=_read_float(row[1] if len(row) > 1 else 0),
        )
        cache.set(
            cache_key,
            {
                "p90_activity_count": baseline.p90_activity_count,
                "p90_active_users": baseline.p90_active_users,
            },
            ACCOUNT_HEALTH_BASELINE_CACHE_TTL_SECONDS,
        )
        return baseline

    def _load_account_metrics(
        self,
        *,
        group_type_index: int,
        group_keys: list[str],
        date_from: datetime,
        previous_date_from: datetime,
        date_to: datetime,
        activity_filter: ast.Expr,
    ) -> dict[str, AccountActivityMetrics]:
        group_expr = f"toString(e.$group_{group_type_index})"
        current_condition = "e.timestamp >= {date_from} AND e.timestamp < {date_to}"
        previous_condition = "e.timestamp >= {previous_date_from} AND e.timestamp < {date_from}"
        query = parse_select(
            f"""
            SELECT
                {group_expr} AS group_key,
                countIf({current_condition}) AS current_count,
                countIf({previous_condition}) AS previous_count,
                uniqIf(e.person_id, {current_condition}) AS active_users,
                countDistinctIf(toDate(e.timestamp), {current_condition}) AS active_days,
                max(e.timestamp) AS last_activity_at
            FROM events AS e
            WHERE e.timestamp >= {{previous_date_from}}
              AND e.timestamp < {{date_to}}
              AND notEmpty({group_expr})
              AND {group_expr} IN {{group_keys}}
              AND {{activity_filter}}
            GROUP BY group_key
            """,
            {
                "date_from": ast.Constant(value=date_from),
                "previous_date_from": ast.Constant(value=previous_date_from),
                "date_to": ast.Constant(value=date_to),
                "group_keys": ast.Constant(value=group_keys),
                "activity_filter": activity_filter,
            },
        )
        response = execute_hogql_query(
            query_type="AccountsHealthMetricsQuery",
            query=query,
            team=self.team,
            user=self.user,
            timings=self.timings,
            modifiers=self.modifiers,
        )
        metrics: dict[str, AccountActivityMetrics] = {}
        for row in response.results:
            if not row:
                continue
            group_key = str(row[0])
            metrics[group_key] = AccountActivityMetrics(
                current_count=_read_float(row[1] if len(row) > 1 else 0),
                previous_count=_read_float(row[2] if len(row) > 2 else 0),
                active_users=_read_float(row[3] if len(row) > 3 else 0),
                active_days=_read_float(row[4] if len(row) > 4 else 0),
                last_activity_at=row[5] if len(row) > 5 and isinstance(row[5], datetime) else None,
            )
        return metrics


def _read_float(value: Any) -> float:
    if isinstance(value, (int, float)):
        numeric_value = float(value)
        return numeric_value if math.isfinite(numeric_value) else 0.0
    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return 0.0
    return numeric_value if math.isfinite(numeric_value) else 0.0
