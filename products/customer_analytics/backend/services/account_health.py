"""Explainable account health scoring built on a team's GroupUsageMetric definitions.

Each metric becomes a *factor*: how much of the immediately preceding period's usage was
retained in the current period (current / previous), capped at 100. The overall score is the
rounded mean of the non-null factor scores, which maps to a coarse health bucket. The scoring
functions are pure (no DB / ClickHouse) so they can be unit tested directly; the batched HogQL
evaluation lives in :class:`AccountHealthScorer`.

The evaluation deliberately mirrors ``UsageMetricsQueryRunner`` (same source-descriptor grouping,
same period windows, same event/data-warehouse handling) but batches every account on the current
page into a single query per source+interval group — one ``GROUP BY`` over the group key — instead
of one query per account, so the accounts list stays free of N+1 queries.
"""

from collections.abc import Iterable
from datetime import datetime, timedelta
from functools import cached_property
from zoneinfo import ZoneInfo

from posthog.schema import AccountHealthFactor, AccountHealthScore, AccountHealthStatus, HogQLQueryModifiers

from posthog.hogql import ast
from posthog.hogql.parser import parse_expr
from posthog.hogql.query import execute_hogql_query
from posthog.hogql.timings import HogQLTimings

from posthog.clickhouse.query_tagging import tag_contains_user_hogql
from posthog.models import Team, User
from posthog.models.group_usage_metric import GroupUsageMetric

# A source descriptor groups metrics that read the same underlying table. Events metrics all share
# ``(EVENTS,)``; each data warehouse table/timestamp/key combination is its own descriptor.
SourceDescriptor = tuple[str, ...]

# Score thresholds for the coarse health buckets. ``>= HEALTHY`` is healthy, ``>= NEEDS_ATTENTION``
# needs attention, below that is at risk.
HEALTHY_THRESHOLD = 80
NEEDS_ATTENTION_THRESHOLD = 50


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def compute_factor_score(current: float, previous: float) -> int | None:
    """Retained-usage score for one factor, 0–100.

    - ``previous > 0``: the share of last period's usage retained this period, capped at 100.
    - ``previous == 0`` and ``current > 0``: brand-new usage, treated as fully healthy (100).
    - both zero: no signal, returns ``None`` (excluded from the overall mean).
    """
    if previous > 0:
        return round(_clamp(current / previous * 100, 0, 100))
    if current > 0:
        return 100
    return None


def compute_change_pct(current: float, previous: float) -> float | None:
    """Percentage change current vs previous, or ``None`` when there is no previous baseline."""
    if previous > 0:
        return (current - previous) / previous * 100
    return None


def compute_overall_score(factor_scores: Iterable[int | None]) -> int | None:
    """Rounded mean of the non-null factor scores, or ``None`` when nothing scored."""
    scored = [score for score in factor_scores if score is not None]
    if not scored:
        return None
    return round(sum(scored) / len(scored))


def status_for_score(score: int | None) -> AccountHealthStatus:
    if score is None:
        return AccountHealthStatus.NO_DATA
    if score >= HEALTHY_THRESHOLD:
        return AccountHealthStatus.HEALTHY
    if score >= NEEDS_ATTENTION_THRESHOLD:
        return AccountHealthStatus.NEEDS_ATTENTION
    return AccountHealthStatus.AT_RISK


def no_data_score() -> AccountHealthScore:
    """The score for accounts we cannot evaluate (no external id / config / metrics / signal)."""
    return AccountHealthScore(score=None, status=AccountHealthStatus.NO_DATA, factors=[])


class AccountHealthScorer:
    def __init__(
        self,
        team: Team,
        *,
        timings: HogQLTimings | None = None,
        modifiers: HogQLQueryModifiers | None = None,
        user: User | None = None,
    ) -> None:
        self.team = team
        self.timings = timings or HogQLTimings()
        self.modifiers = modifiers
        self.user = user

    @cached_property
    def account_group_type_index(self) -> int | None:
        return self.team.customer_analytics_config.account_group_type_index

    @cached_property
    def usage_metrics(self) -> list[GroupUsageMetric]:
        # Mirrors UsageMetricsQueryRunner: every team-owned metric applies, regardless of the
        # metric's own (legacy) group_type_index.
        with self.timings.measure("account_health_get_usage_metrics"):
            return list(
                GroupUsageMetric.objects.filter(team=self.team).only(
                    "id", "name", "interval", "filters", "math", "math_property"
                )
            )

    def usage_metric_fingerprints(self) -> list[tuple[str, ...]]:
        """Stable per-metric fingerprints for the query cache key, sorted for determinism."""
        return sorted(
            (str(m.id), m.math, m.math_property or "", str(m.filters), str(m.interval)) for m in self.usage_metrics
        )

    def config_fingerprint(self) -> int | None:
        """The piece of team config that changes scores — the group type accounts join on."""
        return self.account_group_type_index

    def score_external_ids(self, external_ids: Iterable[str | None]) -> dict[str, AccountHealthScore]:
        """Score the given (current-page) external ids. Returns a map keyed by external id.

        Accounts with a missing external id are not included in the map — the caller resolves
        them to :func:`no_data_score`. When the team has no config or no usable metrics every
        present external id maps to no_data.
        """
        present_ids = sorted({external_id for external_id in external_ids if external_id})
        if not present_ids:
            return {}

        if self.account_group_type_index is None:
            return {external_id: no_data_score() for external_id in present_ids}

        source_groups = self._group_metrics_by_source_and_interval()
        if not source_groups:
            return {external_id: no_data_score() for external_id in present_ids}

        date_to = datetime.now(tz=ZoneInfo("UTC"))
        # metric_values[external_id][metric_id] = (current_total, previous_total)
        metric_values: dict[str, dict[str, tuple[float, float]]] = {}
        for (source_descriptor, interval), group in source_groups.items():
            self._collect_group_values(source_descriptor, interval, group, present_ids, date_to, metric_values)

        ordered_metrics = self._ordered_metrics(source_groups)
        return {
            external_id: self._score_for(external_id, ordered_metrics, metric_values.get(external_id, {}))
            for external_id in present_ids
        }

    def _score_for(
        self,
        external_id: str,
        ordered_metrics: list[GroupUsageMetric],
        values_by_metric: dict[str, tuple[float, float]],
    ) -> AccountHealthScore:
        factors: list[AccountHealthFactor] = []
        factor_scores: list[int | None] = []
        for metric in ordered_metrics:
            current, previous = values_by_metric.get(str(metric.id), (0.0, 0.0))
            factor_score = compute_factor_score(current, previous)
            factor_scores.append(factor_score)
            factors.append(
                AccountHealthFactor(
                    metric_id=str(metric.id),
                    metric_name=metric.name,
                    interval=metric.interval,
                    current=current,
                    previous=previous,
                    factor_score=factor_score,
                    change_pct=compute_change_pct(current, previous),
                )
            )

        overall = compute_overall_score(factor_scores)
        if overall is None:
            # Metrics exist but this account has no usable signal — surface the (all no-signal)
            # factors so the detail view can still explain what was evaluated.
            return AccountHealthScore(score=None, status=AccountHealthStatus.NO_DATA, factors=factors)
        return AccountHealthScore(score=overall, status=status_for_score(overall), factors=factors)

    @staticmethod
    def _source_descriptor(metric: GroupUsageMetric) -> SourceDescriptor:
        if metric.is_data_warehouse:
            filters = metric.filters or {}
            return (
                GroupUsageMetric.Source.DATA_WAREHOUSE,
                filters.get("table_name"),
                filters.get("timestamp_field"),
                filters.get("key_field"),
            )
        return (GroupUsageMetric.Source.EVENTS,)

    def _group_metrics_by_source_and_interval(
        self,
    ) -> dict[tuple[SourceDescriptor, int], list[tuple[GroupUsageMetric, ast.Expr]]]:
        groups: dict[tuple[SourceDescriptor, int], list[tuple[GroupUsageMetric, ast.Expr]]] = {}
        for metric in self.usage_metrics:
            if metric.math == GroupUsageMetric.Math.SUM and not metric.math_property:
                continue
            source_descriptor = self._source_descriptor(metric)
            if source_descriptor[0] == GroupUsageMetric.Source.DATA_WAREHOUSE and (
                len(source_descriptor) != 4 or not all(source_descriptor[1:])
            ):
                continue
            with self.timings.measure("account_health_metric_filter_expr"):
                filter_expr = metric.get_expr()
            if not metric.is_data_warehouse and filter_expr == ast.Constant(value=True):
                # An events metric with no real filter would scan all events; skip it.
                continue
            key = (source_descriptor, metric.interval)
            groups.setdefault(key, []).append((metric, filter_expr))
        return groups

    @staticmethod
    def _ordered_metrics(
        source_groups: dict[tuple[SourceDescriptor, int], list[tuple[GroupUsageMetric, ast.Expr]]],
    ) -> list[GroupUsageMetric]:
        metrics = [metric for group in source_groups.values() for metric, _ in group]
        # Deterministic factor order regardless of grouping/query order.
        return sorted(metrics, key=lambda m: (m.name, str(m.id)))

    def _collect_group_values(
        self,
        source_descriptor: SourceDescriptor,
        interval: int,
        group: list[tuple[GroupUsageMetric, ast.Expr]],
        external_ids: list[str],
        date_to: datetime,
        metric_values: dict[str, dict[str, tuple[float, float]]],
    ) -> None:
        query = self._build_group_query(source_descriptor, interval, group, external_ids, date_to)
        with self.timings.measure(f"account_health_{source_descriptor[0]}_{interval}_execute"):
            response = execute_hogql_query(
                query_type="account_health_query",
                query=query,
                team=self.team,
                user=self.user,
                timings=self.timings,
                modifiers=self.modifiers,
            )
        for row in response.results or []:
            external_id = row[0]
            for i, (metric, _filter_expr) in enumerate(group):
                current = float(row[1 + i * 2] or 0)
                previous = float(row[2 + i * 2] or 0)
                metric_values.setdefault(external_id, {})[str(metric.id)] = (current, previous)

    def _build_group_query(
        self,
        source_descriptor: SourceDescriptor,
        interval: int,
        group: list[tuple[GroupUsageMetric, ast.Expr]],
        external_ids: list[str],
        date_to: datetime,
    ) -> ast.SelectQuery:
        # Each helper returns a fresh AST node per call — the HogQL resolver mutates ``node.type``
        # in place, so a single node cannot be shared across multiple positions in the tree.
        date_from = date_to - timedelta(days=interval)
        prev_date_from = date_to - 2 * timedelta(days=interval)

        current_condition = self._period_condition(source_descriptor, date_from, date_to)
        previous_condition = self._period_condition(source_descriptor, prev_date_from, date_from, upper_exclusive=True)

        select_exprs: list[ast.Expr] = [ast.Alias(alias="group_key", expr=self._group_key_expr(source_descriptor))]
        for i, (metric, filter_expr) in enumerate(group):
            value_expr, prev_expr = self._conditional_aggregation(
                metric, filter_expr, current_condition, previous_condition
            )
            select_exprs.append(ast.Alias(alias=f"m{i}_value", expr=value_expr))
            select_exprs.append(ast.Alias(alias=f"m{i}_previous", expr=prev_expr))

        where_exprs: list[ast.Expr] = [
            ast.CompareOperation(
                op=ast.CompareOperationOp.In,
                left=self._group_key_expr(source_descriptor),
                right=ast.Tuple(exprs=[ast.Constant(value=external_id) for external_id in external_ids]),
            ),
            ast.CompareOperation(
                op=ast.CompareOperationOp.GtEq,
                left=self._timestamp_expr(source_descriptor),
                right=ast.Constant(value=prev_date_from),
            ),
            ast.CompareOperation(
                op=ast.CompareOperationOp.LtEq,
                left=self._timestamp_expr(source_descriptor),
                right=ast.Constant(value=date_to),
            ),
        ]

        return ast.SelectQuery(
            select=select_exprs,
            select_from=ast.JoinExpr(table=self._table_expr(source_descriptor)),
            where=ast.And(exprs=where_exprs),
            group_by=[ast.Field(chain=["group_key"])],
        )

    def _group_key_expr(self, source_descriptor: SourceDescriptor) -> ast.Expr:
        if source_descriptor[0] == GroupUsageMetric.Source.DATA_WAREHOUSE:
            key_field = source_descriptor[3]
            if not key_field:
                raise ValueError("data_warehouse usage metric is missing 'key_field' in filters")
            tag_contains_user_hogql()
            return parse_expr(key_field)
        return ast.Field(chain=[f"$group_{self.account_group_type_index}"])

    def _table_expr(self, source_descriptor: SourceDescriptor) -> ast.Field:
        if source_descriptor[0] == GroupUsageMetric.Source.DATA_WAREHOUSE:
            return ast.Field(chain=[source_descriptor[1]])
        return ast.Field(chain=["events"])

    def _timestamp_expr(self, source_descriptor: SourceDescriptor) -> ast.Expr:
        if source_descriptor[0] == GroupUsageMetric.Source.DATA_WAREHOUSE:
            timestamp_field = source_descriptor[2]
            if not timestamp_field:
                raise ValueError("data_warehouse usage metric is missing 'timestamp_field' in filters")
            tag_contains_user_hogql()
            return parse_expr(timestamp_field)
        return ast.Field(chain=["timestamp"])

    def _period_condition(
        self,
        source_descriptor: SourceDescriptor,
        period_from: datetime,
        period_to: datetime,
        upper_exclusive: bool = False,
    ) -> ast.Expr:
        upper_op = ast.CompareOperationOp.Lt if upper_exclusive else ast.CompareOperationOp.LtEq
        return ast.And(
            exprs=[
                ast.CompareOperation(
                    op=ast.CompareOperationOp.GtEq,
                    left=self._timestamp_expr(source_descriptor),
                    right=ast.Constant(value=period_from),
                ),
                ast.CompareOperation(
                    op=upper_op,
                    left=self._timestamp_expr(source_descriptor),
                    right=ast.Constant(value=period_to),
                ),
            ]
        )

    def _conditional_aggregation(
        self,
        metric: GroupUsageMetric,
        filter_expr: ast.Expr,
        current_condition: ast.Expr,
        previous_condition: ast.Expr,
    ) -> tuple[ast.Expr, ast.Expr]:
        current_cond = ast.And(exprs=[filter_expr, current_condition])
        previous_cond = ast.And(exprs=[filter_expr, previous_condition])

        if metric.math == GroupUsageMetric.Math.SUM:
            if metric.is_data_warehouse:
                tag_contains_user_hogql()
                value_arg: ast.Expr = ast.Call(name="toFloat", args=[parse_expr(metric.math_property)])
            else:
                value_arg = ast.Call(name="toFloat", args=[ast.Field(chain=["properties", metric.math_property])])
            return (
                ast.Call(
                    name="ifNull", args=[ast.Call(name="sumIf", args=[value_arg, current_cond]), ast.Constant(value=0)]
                ),
                ast.Call(
                    name="ifNull", args=[ast.Call(name="sumIf", args=[value_arg, previous_cond]), ast.Constant(value=0)]
                ),
            )

        return (
            ast.Call(name="toFloat", args=[ast.Call(name="countIf", args=[current_cond])]),
            ast.Call(name="toFloat", args=[ast.Call(name="countIf", args=[previous_cond])]),
        )
