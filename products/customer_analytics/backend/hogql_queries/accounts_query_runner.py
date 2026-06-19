from collections.abc import Sequence
from functools import cached_property
from typing import cast

from posthog.schema import AccountsQuery, AccountsQueryResponse, CachedAccountsQueryResponse

from posthog.hogql import ast
from posthog.hogql.errors import BaseHogQLError, ExposedHogQLError
from posthog.hogql.parser import parse_expr, parse_order_expr, parse_select
from posthog.hogql.query import execute_hogql_query

from posthog.errors import ExposedCHQueryError, InternalCHQueryError
from posthog.exceptions_capture import capture_exception
from posthog.hogql_queries.insights.paginators import HogQLHasMorePaginator
from posthog.hogql_queries.query_runner import AnalyticsQueryRunner
from posthog.models import User
from posthog.rbac.user_access_control import UserAccessControl

from products.customer_analytics.backend.services.account_health import AccountHealthScorer, no_data_score

NAME_COLUMN = "name"

# Synthetic column: not a real `system.accounts` field. When selected, the runner computes an
# explainable AccountHealthScore per row from the team's GroupUsageMetric definitions and injects
# it into the results. Callers that omit it do zero health work.
HEALTH_COLUMN = "health_score"

DEFAULT_COLUMNS = (NAME_COLUMN, "created_at")

DEFAULT_ORDER_BY = "created_at DESC"


def _normalize_order_clause(raw: str) -> str:
    """Allow Django-style `-col` shorthand alongside native HogQL `col DESC`."""
    stripped = raw.strip()
    if stripped.startswith("-"):
        return f"{stripped[1:].strip()} DESC"
    return stripped


# Account-properties JSON keys for the three assignable roles. The
# `allRolesUnassigned` filter ("Unassigned only") requires every one of these to
# be empty.
ROLE_JSON_KEYS = ("csm", "account_executive", "account_owner")

# Roles that count as "assigned" for the `assignedToUserIds` filter — an account
# is assigned to a user if they are its CSM or account executive.
ASSIGNED_ROLE_KEYS = ("csm", "account_executive")


class AccountsQueryRunner(AnalyticsQueryRunner[AccountsQueryResponse]):
    query: AccountsQuery
    cached_response: CachedAccountsQueryResponse

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        # Metrics-only callers (just aggregations, no `select`) skip column
        # resolution. A combined query carries both `select` and `metrics`.
        self._metrics_only = bool(self.query.metrics) and not self.query.select

        # `columns` is the full ordered set the frontend renders (it may include the synthetic
        # `health_score`). `_real_columns` / `_select_exprs` are the subset backed by an actual
        # HogQL expression, aligned 1:1 with the query result row positions.
        self.columns: list[str] = []
        self._real_columns: list[str] = []
        self._select_exprs: list[ast.Expr] = []
        self._health_requested = False
        if not self._metrics_only:
            raw_selects = list(self.query.select) if self.query.select else list(DEFAULT_COLUMNS)
            seen: set[str] = set()
            for raw in raw_selects:
                if raw == HEALTH_COLUMN:
                    if HEALTH_COLUMN in seen:
                        continue
                    seen.add(HEALTH_COLUMN)
                    self._health_requested = True
                    self.columns.append(HEALTH_COLUMN)
                    continue
                column_name, expr = self._resolve_column(raw)
                if column_name in seen:
                    continue
                seen.add(column_name)
                self.columns.append(column_name)
                self._real_columns.append(column_name)
                self._select_exprs.append(expr)
            if NAME_COLUMN not in seen:
                self.columns.insert(0, NAME_COLUMN)
                self._real_columns.insert(0, NAME_COLUMN)
                self._select_exprs.insert(0, self._name_tuple_expr())

        self.paginator = HogQLHasMorePaginator.from_limit_context(
            limit_context=self.limit_context,
            limit=self.query.limit,
            offset=self.query.offset,
        )

    def validate_query_runner_access(self, user: User) -> bool:
        return UserAccessControl(user=user, team=self.team).assert_access_level_for_resource(
            "customer_analytics", "viewer"
        )

    @cached_property
    def _health_scorer(self) -> AccountHealthScorer:
        return AccountHealthScorer(team=self.team, timings=self.timings, modifiers=self.modifiers, user=self.user)

    def get_cache_payload(self) -> dict:
        payload = super().get_cache_payload()
        # Only health requests depend on usage-metric definitions and the configured group type —
        # fold their fingerprints into the cache key so edits invalidate exactly those results, and
        # leave non-health callers' cache keys untouched (and free of any GroupUsageMetric query).
        if self._health_requested:
            payload["account_health"] = {
                "usage_metric_fingerprints": self._health_scorer.usage_metric_fingerprints(),
                "account_group_type_index": self._health_scorer.config_fingerprint(),
            }
        return payload

    def _resolve_column(self, raw: str) -> tuple[str, ast.Expr]:
        if raw == NAME_COLUMN:
            return NAME_COLUMN, self._name_tuple_expr()
        expr = parse_expr(raw)
        column_name = expr.alias if isinstance(expr, ast.Alias) else raw
        return column_name, expr

    def _name_tuple_expr(self) -> ast.Expr:
        # Single cell carries the display name, external_id (for copy
        # affordance) and id (for row expansion / role updates), so the
        # frontend doesn't need to pin id and external_id as separate
        # hidden columns. Mirrors groups_query_runner's `group_name`.
        return ast.Alias(
            alias=NAME_COLUMN,
            expr=ast.Call(
                name="tuple",
                args=[
                    ast.Field(chain=["name"]),
                    ast.Field(chain=["external_id"]),
                    ast.Call(name="toString", args=[ast.Field(chain=["id"])]),
                ],
            ),
        )

    def _build_where_exprs(self) -> list[ast.Expr]:
        where_exprs: list[ast.Expr] = []

        if self.query.search and self.query.search.strip():
            pattern = f"%{self.query.search.strip()}%"
            where_exprs.append(
                parse_expr(
                    "accounts.name ILIKE {pattern} OR accounts.external_id ILIKE {pattern}",
                    {"pattern": ast.Constant(value=pattern)},
                )
            )

        if self.query.tagNames:
            where_exprs.append(self._tag_filter_expr(self.query.tagNames))

        if self.query.allRolesUnassigned:
            for json_key in ROLE_JSON_KEYS:
                where_exprs.append(self._role_id_isnull(json_key))

        if self.query.assignedToUserIds:
            where_exprs.append(self._assigned_to_users_expr(self.query.assignedToUserIds))

        if self.query.filterExpression and self.query.filterExpression.strip():
            where_exprs.append(parse_expr(self.query.filterExpression))

        return where_exprs

    def to_query(self) -> ast.SelectQuery:
        where_exprs = self._build_where_exprs()
        requested_order_clauses = self.query.orderBy or []
        order_clauses = [
            clause
            for clause in requested_order_clauses
            if _normalize_order_clause(clause).split(maxsplit=1)[0] != HEALTH_COLUMN
        ] or [DEFAULT_ORDER_BY]

        return ast.SelectQuery(
            select=self._select_exprs,
            select_from=ast.JoinExpr(
                table=ast.Field(chain=["system", "accounts"]),
                alias="accounts",
            ),
            where=ast.And(exprs=where_exprs) if where_exprs else None,
            order_by=[parse_order_expr(_normalize_order_clause(c), timings=self.timings) for c in order_clauses],
        )

    def _to_metrics_query(self, metrics: list[str]) -> ast.SelectQuery:
        where_exprs = self._build_where_exprs()
        select_exprs = [parse_expr(expr) for expr in metrics]
        return ast.SelectQuery(
            select=select_exprs,
            select_from=ast.JoinExpr(
                table=ast.Field(chain=["system", "accounts"]),
                alias="accounts",
            ),
            where=ast.And(exprs=where_exprs) if where_exprs else None,
        )

    def _tag_filter_expr(self, tag_names: list[str]) -> ast.Expr:
        subquery = parse_select(
            """
            SELECT ti.account_id
            FROM system._account_tagged_items AS ti
            INNER JOIN system.tags AS t ON t.id = ti.tag_id
            WHERE t.name IN {tag_names}
            """,
            {"tag_names": ast.Constant(value=list(tag_names))},
        )
        return parse_expr("id IN {subquery}", {"subquery": subquery})

    def _role_filter_expr(self, json_key: str, value: object) -> ast.Expr | None:
        if not value:
            return None
        raw_values = value if isinstance(value, list) else [value]
        user_ids: list[int] = []
        for raw in raw_values:
            if isinstance(raw, int):
                user_ids.append(raw)
            elif isinstance(raw, str):
                try:
                    user_ids.append(int(raw))
                except ValueError:
                    continue
        if not user_ids:
            return None
        return parse_expr(
            "JSONExtract(properties, {role_key}, 'id', 'Nullable(Int64)') IN {user_ids}",
            {
                "role_key": ast.Constant(value=json_key),
                "user_ids": ast.Constant(value=user_ids),
            },
        )

    def _role_id_isnull(self, json_key: str) -> ast.Expr:
        return parse_expr(
            "isNull(JSONExtract(properties, {role_key}, 'id', 'Nullable(Int64)'))",
            {"role_key": ast.Constant(value=json_key)},
        )

    def _assigned_to_users_expr(self, user_ids: list[int]) -> ast.Expr:
        # OR over the CSM/AE roles: an account is "assigned to" a user if they
        # hold either role. Explicit ids (not the requester) so a shared URL
        # filtered by "my accounts" resolves to the same accounts for every viewer.
        role_exprs: list[ast.Expr] = []
        for json_key in ASSIGNED_ROLE_KEYS:
            role_expr = self._role_filter_expr(json_key, user_ids)
            if role_expr is not None:
                role_exprs.append(role_expr)
        if not role_exprs:
            return ast.Constant(value=False)
        return ast.Or(exprs=role_exprs)

    def _calculate(self) -> AccountsQueryResponse:
        metrics_results = self._compute_metrics_results(self.query.metrics) if self.query.metrics else None

        if self._metrics_only:
            return AccountsQueryResponse(
                kind="AccountsQuery",
                columns=[],
                results=[],
                types=[],
                metricsResults=metrics_results,
                hogql="",
                modifiers=self.modifiers,
                limit=self.query.limit or 0,
                offset=self.query.offset or 0,
            )

        response = self.paginator.execute_hogql_query(
            query_type="AccountsQuery",
            query=self.to_query(),
            team=self.team,
            user=self.user,
            timings=self.timings,
            modifiers=self.modifiers,
        )

        results = self._build_results(self.paginator.results)

        return AccountsQueryResponse(
            kind="AccountsQuery",
            columns=list(self.columns),
            results=results,
            types=self._align_types(response.types),
            metricsResults=metrics_results,
            hogql=response.hogql or "",
            timings=response.timings,
            modifiers=self.modifiers,
            **self.paginator.response_params(),
        )

    def _build_results(self, rows: Sequence[Sequence[object]]) -> list[list[object]]:
        # Rows come back aligned to `_real_columns`; rebuild them in `self.columns` order,
        # expanding the name tuple into its dict shape and injecting the synthetic health cell.
        real_name_index = self._real_columns.index(NAME_COLUMN)
        real_index_by_col = {col: index for index, col in enumerate(self._real_columns)}

        health_by_external_id: dict[str, object] = {}
        if self._health_requested:
            # Batch only the current page's external ids — no per-row (N+1) health queries.
            external_ids = [
                cast(str | None, cast(Sequence[object], row[real_name_index])[1])
                for row in rows
            ]
            try:
                health_by_external_id = self._health_scorer.score_external_ids(external_ids)
            except Exception as error:
                # Health is a derived enhancement, so a bad usage metric or transient query failure
                # must not take down the core accounts list.
                capture_exception(error, {"scope": "accounts_query_runner.health", "team_id": self.team.id})

        results: list[list[object]] = []
        for row in rows:
            name_cell = cast(Sequence[object], row[real_name_index])
            external_id = cast(str | None, name_cell[1])
            out_row: list[object] = []
            for col in self.columns:
                if col == HEALTH_COLUMN:
                    score = health_by_external_id.get(external_id) if external_id else None
                    out_row.append((score or no_data_score()).model_dump(mode="json"))
                elif col == NAME_COLUMN:
                    out_row.append({"name": name_cell[0], "external_id": name_cell[1], "id": name_cell[2]})
                else:
                    out_row.append(row[real_index_by_col[col]])
            results.append(out_row)
        return results

    def _align_types(self, response_types: Sequence[tuple[str, str]] | None) -> list[str]:
        # The synthetic health column has no HogQL type; insert a placeholder so `types` stays
        # aligned with `columns` for any consumer that zips them.
        type_by_col = {}
        if response_types:
            for real_col, (_, col_type) in zip(self._real_columns, response_types):
                type_by_col[real_col] = col_type
        return [("AccountHealthScore" if col == HEALTH_COLUMN else type_by_col.get(col, "")) for col in self.columns]

    def _compute_metrics_results(self, metrics: list[str]) -> list[float | int | None]:
        try:
            response = self._execute_metrics_query(metrics)
        except (InternalCHQueryError, BaseHogQLError) as error:
            raise self._metric_evaluation_error(metrics, error) from error

        row = response.results[0] if response.results else []
        metrics_results: list[float | int | None] = [
            (value if isinstance(value, (int, float)) else None) for value in row
        ]
        while len(metrics_results) < len(metrics):
            metrics_results.append(None)
        return metrics_results

    def _execute_metrics_query(self, metrics: list[str]):
        return execute_hogql_query(
            query_type="AccountsMetricsQuery",
            query=self._to_metrics_query(metrics),
            team=self.team,
            user=self.user,
            timings=self.timings,
            modifiers=self.modifiers,
        )

    def _metric_evaluation_error(self, metrics: list[str], error: Exception) -> ExposedHogQLError:
        culprits = self._isolate_failing_metrics(metrics) if len(metrics) > 1 else list(metrics)
        listed = ", ".join(f"`{expr}`" for expr in (culprits or metrics))
        plural = "s" if len(culprits or metrics) > 1 else ""
        detail = (
            f"Could not evaluate overview tile metric{plural}: {listed}. "
            "Check that any referenced column exists and is numeric "
            "(data warehouse columns must be synced)."
        )
        if isinstance(error, (ExposedHogQLError, ExposedCHQueryError)):
            detail = f"{detail} {error}"
        return ExposedHogQLError(detail)

    def _isolate_failing_metrics(self, metrics: list[str]) -> list[str]:
        """Re-run each metric on its own (error path only) to name the offenders."""
        failing: list[str] = []
        for expr in metrics:
            try:
                self._execute_metrics_query([expr])
            except Exception:
                failing.append(expr)
        return failing
