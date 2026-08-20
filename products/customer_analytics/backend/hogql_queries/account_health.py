import math
from collections.abc import Iterable
from datetime import datetime, timedelta
from functools import cached_property
from zoneinfo import ZoneInfo

from posthog.schema import (
    AccountHealthFactor,
    AccountHealthNoDataReason,
    AccountHealthScore,
    AccountHealthStatus,
    HogQLQueryModifiers,
)

from posthog.hogql import ast
from posthog.hogql.query import execute_hogql_query
from posthog.hogql.timings import HogQLTimings
from posthog.hogql.visitor import clone_expr

from posthog.models import Team, User
from posthog.models.group_usage_metric import GroupUsageMetric

ACCOUNT_HEALTH_LOOKBACK_DAYS = 30
ACCOUNT_HEALTH_MAX_METRICS = 5
ACCOUNT_HEALTHY_THRESHOLD = 80
ACCOUNT_HEALTH_NEUTRAL_THRESHOLD = 50


def _period_boundaries(date_to: datetime) -> tuple[datetime, datetime]:
    current_period_start = date_to - timedelta(days=ACCOUNT_HEALTH_LOOKBACK_DAYS)
    return current_period_start - timedelta(days=ACCOUNT_HEALTH_LOOKBACK_DAYS), current_period_start


def _round_score(value: float) -> int:
    return math.floor(value + 0.5)


def normalize_health_factor(current: float, previous: float) -> int | None:
    if previous > 0:
        return _round_score(min(max(current, 0) / previous, 1) * 100)
    if current > 0:
        return 100
    return None


def account_health_status(score: int | None) -> AccountHealthStatus:
    if score is None:
        return AccountHealthStatus.NO_DATA
    if score >= ACCOUNT_HEALTHY_THRESHOLD:
        return AccountHealthStatus.HEALTHY
    if score >= ACCOUNT_HEALTH_NEUTRAL_THRESHOLD:
        return AccountHealthStatus.NEUTRAL
    return AccountHealthStatus.AT_RISK


def build_account_health(
    metric_values: list[tuple[GroupUsageMetric, float, float]],
    *,
    date_to: datetime,
    no_data_reason: AccountHealthNoDataReason | None = None,
) -> AccountHealthScore:
    normalized_scores = [normalize_health_factor(current, previous) for _, current, previous in metric_values]
    available_scores = [score for score in normalized_scores if score is not None]
    overall_score = _round_score(sum(available_scores) / len(available_scores)) if available_scores else None
    available_count = len(available_scores)
    factors = [
        AccountHealthFactor(
            metricId=str(metric.id),
            metricName=metric.name,
            current=current,
            previous=previous,
            normalizedScore=normalized_score,
            contribution=normalized_score / available_count if normalized_score is not None else None,
        )
        for (metric, current, previous), normalized_score in zip(metric_values, normalized_scores, strict=True)
    ]
    previous_period_start, current_period_start = _period_boundaries(date_to)
    return AccountHealthScore(
        score=overall_score,
        status=account_health_status(overall_score),
        factors=factors,
        lookbackDays=ACCOUNT_HEALTH_LOOKBACK_DAYS,
        previousPeriodStart=previous_period_start,
        currentPeriodStart=current_period_start,
        computedAt=date_to,
        isLimited=bool(metric_values)
        and (available_count < len(metric_values) or any(previous <= 0 for _, _, previous in metric_values)),
        noDataReason=no_data_reason if overall_score is None else None,
    )


def no_data_account_health(reason: AccountHealthNoDataReason, *, date_to: datetime | None = None) -> AccountHealthScore:
    return build_account_health([], date_to=date_to or datetime.now(tz=ZoneInfo("UTC")), no_data_reason=reason)


class AccountHealthScorer:
    def __init__(
        self,
        *,
        team: Team,
        timings: HogQLTimings,
        modifiers: HogQLQueryModifiers | None,
        user: User | None,
    ) -> None:
        self.team = team
        self.timings = timings
        self.modifiers = modifiers
        self.user = user

    @cached_property
    def group_type_index(self) -> int | None:
        return self.team.customer_analytics_config.account_group_type_index

    @cached_property
    def metrics(self) -> list[GroupUsageMetric]:
        metrics = (
            GroupUsageMetric.objects.filter(team_id=self.team.id)
            .order_by("name", "id")
            .only("id", "name", "filters", "math", "math_property")
        )
        return [metric for metric in metrics if not metric.is_data_warehouse]

    @cached_property
    def eligible_metrics(self) -> list[tuple[GroupUsageMetric, ast.Expr]]:
        eligible: list[tuple[GroupUsageMetric, ast.Expr]] = []
        for metric in self.metrics:
            if metric.math == GroupUsageMetric.Math.SUM and not metric.math_property:
                continue
            filter_expr = metric.get_expr()
            if filter_expr == ast.Constant(value=True):
                continue
            eligible.append((metric, filter_expr))
            if len(eligible) == ACCOUNT_HEALTH_MAX_METRICS:
                break
        return eligible

    def cache_fingerprint(self) -> dict[str, object]:
        return {
            "group_type_index": self.group_type_index,
            "metrics": [
                (str(metric.id), metric.name, metric.math, metric.math_property or "", str(metric.filters))
                for metric in self.metrics
            ],
        }

    def score_external_ids(self, external_ids: Iterable[str | None]) -> dict[str, AccountHealthScore]:
        account_keys = sorted({external_id for external_id in external_ids if external_id})
        if not account_keys:
            return {}

        date_to = datetime.now(tz=ZoneInfo("UTC"))
        if self.group_type_index is None:
            return {
                account_key: no_data_account_health(AccountHealthNoDataReason.MISSING_GROUP_TYPE, date_to=date_to)
                for account_key in account_keys
            }
        if not self.eligible_metrics:
            return {
                account_key: no_data_account_health(AccountHealthNoDataReason.NO_METRICS, date_to=date_to)
                for account_key in account_keys
            }

        response = execute_hogql_query(
            query_type="account_health",
            query=self._query(account_keys, date_to),
            team=self.team,
            user=self.user,
            timings=self.timings,
            modifiers=self.modifiers,
        )
        values_by_account = self._values_by_account(response.results or [])
        return {
            account_key: build_account_health(
                [
                    (metric, *values_by_account.get(account_key, {}).get(str(metric.id), (0.0, 0.0)))
                    for metric, _ in self.eligible_metrics
                ],
                date_to=date_to,
                no_data_reason=AccountHealthNoDataReason.NO_ACTIVITY,
            )
            for account_key in account_keys
        }

    def _query(self, account_keys: list[str], date_to: datetime) -> ast.SelectQuery:
        previous_period_start, current_period_start = _period_boundaries(date_to)
        group_field = ast.Field(chain=["events", "properties", f"$group_{self.group_type_index}"])
        select: list[ast.Expr] = [ast.Alias(alias="account_key", expr=group_field)]
        for index, (metric, filter_expr) in enumerate(self.eligible_metrics):
            current, previous = self._metric_aggregations(
                metric,
                filter_expr,
                previous_period_start=previous_period_start,
                current_period_start=current_period_start,
                date_to=date_to,
            )
            select.extend(
                [
                    ast.Alias(alias=f"metric_{index}_current", expr=current),
                    ast.Alias(alias=f"metric_{index}_previous", expr=previous),
                ]
            )

        return ast.SelectQuery(
            select=select,
            select_from=ast.JoinExpr(table=ast.Field(chain=["events"])),
            where=ast.And(
                exprs=[
                    ast.CompareOperation(
                        op=ast.CompareOperationOp.In,
                        left=ast.Field(chain=["events", "properties", f"$group_{self.group_type_index}"]),
                        right=ast.Array(exprs=[ast.Constant(value=account_key) for account_key in account_keys]),
                    ),
                    ast.CompareOperation(
                        op=ast.CompareOperationOp.GtEq,
                        left=ast.Field(chain=["timestamp"]),
                        right=ast.Constant(value=previous_period_start),
                    ),
                    ast.CompareOperation(
                        op=ast.CompareOperationOp.LtEq,
                        left=ast.Field(chain=["timestamp"]),
                        right=ast.Constant(value=date_to),
                    ),
                ]
            ),
            group_by=[ast.Field(chain=["account_key"])],
            limit=ast.Constant(value=len(account_keys)),
        )

    @staticmethod
    def _metric_aggregations(
        metric: GroupUsageMetric,
        filter_expr: ast.Expr,
        *,
        previous_period_start: datetime,
        current_period_start: datetime,
        date_to: datetime,
    ) -> tuple[ast.Expr, ast.Expr]:
        current_condition = ast.And(
            exprs=[
                clone_expr(filter_expr),
                ast.CompareOperation(
                    op=ast.CompareOperationOp.GtEq,
                    left=ast.Field(chain=["timestamp"]),
                    right=ast.Constant(value=current_period_start),
                ),
                ast.CompareOperation(
                    op=ast.CompareOperationOp.LtEq,
                    left=ast.Field(chain=["timestamp"]),
                    right=ast.Constant(value=date_to),
                ),
            ]
        )
        previous_condition = ast.And(
            exprs=[
                clone_expr(filter_expr),
                ast.CompareOperation(
                    op=ast.CompareOperationOp.GtEq,
                    left=ast.Field(chain=["timestamp"]),
                    right=ast.Constant(value=previous_period_start),
                ),
                ast.CompareOperation(
                    op=ast.CompareOperationOp.Lt,
                    left=ast.Field(chain=["timestamp"]),
                    right=ast.Constant(value=current_period_start),
                ),
            ]
        )
        if metric.math == GroupUsageMetric.Math.SUM:
            value = ast.Call(name="toFloat", args=[ast.Field(chain=["properties", metric.math_property])])
            return (
                ast.Call(
                    name="ifNull",
                    args=[ast.Call(name="sumIf", args=[clone_expr(value), current_condition]), ast.Constant(value=0)],
                ),
                ast.Call(
                    name="ifNull",
                    args=[ast.Call(name="sumIf", args=[clone_expr(value), previous_condition]), ast.Constant(value=0)],
                ),
            )
        return (
            ast.Call(name="toFloat", args=[ast.Call(name="countIf", args=[current_condition])]),
            ast.Call(name="toFloat", args=[ast.Call(name="countIf", args=[previous_condition])]),
        )

    def _values_by_account(self, rows: list[list[object]]) -> dict[str, dict[str, tuple[float, float]]]:
        values: dict[str, dict[str, tuple[float, float]]] = {}
        for row in rows:
            if not row or not isinstance(row[0], str):
                continue
            metric_values: dict[str, tuple[float, float]] = {}
            for index, (metric, _) in enumerate(self.eligible_metrics):
                current_index = 1 + index * 2
                previous_index = current_index + 1
                current_value = row[current_index] if len(row) > current_index else 0.0
                previous_value = row[previous_index] if len(row) > previous_index else 0.0
                current = float(current_value) if isinstance(current_value, int | float | str) else 0.0
                previous = float(previous_value) if isinstance(previous_value, int | float | str) else 0.0
                metric_values[str(metric.id)] = (current, previous)
            values[row[0]] = metric_values
        return values
