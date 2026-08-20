from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from freezegun import freeze_time
from posthog.test.base import APIBaseTest, ClickhouseTestMixin, _create_event, _create_person, flush_persons_and_events
from unittest.mock import patch

from parameterized import parameterized

from posthog.schema import (
    AccountHealthNoDataReason,
    AccountsTableAccountField,
    AccountsTableAccountFieldColumn,
    AccountsTableNoteCountColumn,
    AccountsTableQuery,
    AccountsTableTagsColumn,
)

from posthog.hogql.query import execute_hogql_query
from posthog.hogql.timings import HogQLTimings

from posthog.models import GroupUsageMetric, Team
from posthog.test.persons import create_group, create_group_type_mapping

from products.customer_analytics.backend.hogql_queries.account_health import (
    ACCOUNT_HEALTH_LOOKBACK_DAYS,
    AccountHealthScorer,
    build_account_health,
    normalize_health_factor,
)
from products.customer_analytics.backend.hogql_queries.accounts_table_query_runner import AccountsTableQueryRunner
from products.customer_analytics.backend.models import Account


class TestAccountHealthScoring(APIBaseTest):
    @parameterized.expand(
        [
            (0.0, 0.0, None),
            (5.0, 0.0, 100),
            (0.0, 5.0, 0),
            (12.0, 10.0, 100),
            (2.0, 3.0, 67),
            (-1.0, 3.0, 0),
        ]
    )
    def test_normalizes_factor(self, current: float, previous: float, expected: int | None) -> None:
        assert normalize_health_factor(current, previous) == expected

    def test_builds_score_from_available_factors(self) -> None:
        metrics = [
            GroupUsageMetric(id=uuid4(), name="Events ingested"),
            GroupUsageMetric(id=uuid4(), name="Active users"),
        ]
        now = datetime(2026, 5, 21, tzinfo=UTC)

        health = build_account_health(
            [(metrics[0], 80.0, 100.0), (metrics[1], 0.0, 0.0)],
            date_to=now,
        )

        assert health.score == 80
        assert health.status == "healthy"
        assert health.isLimited is True
        assert [factor.contribution for factor in health.factors] == [80, None]
        assert health.currentPeriodStart == now - timedelta(days=ACCOUNT_HEALTH_LOOKBACK_DAYS)

    def test_returns_no_data_for_an_account_without_usage(self) -> None:
        metric = GroupUsageMetric(id=uuid4(), name="Events ingested")

        health = build_account_health(
            [(metric, 0.0, 0.0)],
            date_to=datetime(2026, 5, 21, tzinfo=UTC),
            no_data_reason=AccountHealthNoDataReason.NO_ACTIVITY,
        )

        assert health.score is None
        assert health.status == "no_data"
        assert health.noDataReason == "no_activity"
        assert health.factors[0].contribution is None

    def test_metric_changes_invalidate_the_cache_fingerprint(self) -> None:
        metric = GroupUsageMetric.objects.create(
            team=self.team,
            group_type_index=0,
            name="Events ingested",
            interval=30,
            filters={"events": [{"id": "account-event", "type": "events", "order": 0}]},
        )
        original = AccountHealthScorer(
            team=self.team,
            timings=HogQLTimings(),
            modifiers=None,
            user=self.user,
        ).cache_fingerprint()

        metric.name = "Active accounts"
        metric.save(update_fields=["name"])
        updated = AccountHealthScorer(
            team=self.team,
            timings=HogQLTimings(),
            modifiers=None,
            user=self.user,
        ).cache_fingerprint()

        assert updated != original


@freeze_time("2026-05-21 12:00:00")
class TestAccountsTableHealthIntegration(ClickhouseTestMixin, APIBaseTest):
    def setUp(self) -> None:
        super().setUp()
        self.group_type_index = 0
        create_group_type_mapping(
            team=self.team,
            project_id=self.team.project_id,
            group_type="organization",
            group_type_index=self.group_type_index,
        )
        config = self.team.customer_analytics_config
        config.account_group_type_index = self.group_type_index
        config.save()

        create_group(team=self.team, group_type_index=self.group_type_index, group_key="acme")
        create_group(team=self.team, group_type_index=self.group_type_index, group_key="globex")
        Account.objects.for_team(self.team.id).create(team_id=self.team.id, external_id="acme", name="Acme")
        Account.objects.for_team(self.team.id).create(team_id=self.team.id, external_id="globex", name="Globex")
        Account.objects.for_team(self.team.id).create(team_id=self.team.id, external_id=None, name="Hooli")

        self.events_metric = GroupUsageMetric.objects.create(
            team=self.team,
            name="Events ingested",
            format="numeric",
            interval=30,
            display="number",
            filters={"events": [{"id": "account-event", "type": "events", "order": 0}]},
            group_type_index=self.group_type_index,
        )
        self.users_metric = GroupUsageMetric.objects.create(
            team=self.team,
            name="Active users",
            format="numeric",
            interval=30,
            display="number",
            filters={"events": [{"id": "user-event", "type": "events", "order": 0}]},
            group_type_index=self.group_type_index,
        )

        person = _create_person(team_id=self.team.pk, distinct_ids=["person"])
        current_timestamp = datetime(2026, 5, 10)
        previous_timestamp = datetime(2026, 4, 10)
        self._capture_events(self.team, person.uuid, "person", "acme", "account-event", current_timestamp, 8)
        self._capture_events(self.team, person.uuid, "person", "acme", "account-event", previous_timestamp, 10)
        self._capture_events(self.team, person.uuid, "person", "acme", "user-event", current_timestamp, 6)
        self._capture_events(self.team, person.uuid, "person", "acme", "user-event", previous_timestamp, 10)
        self._capture_events(self.team, person.uuid, "person", "globex", "account-event", current_timestamp, 2)

        other_team = Team.objects.create(organization=self.organization)
        other_person = _create_person(team_id=other_team.pk, distinct_ids=["other-person"])
        self._capture_events(
            other_team, other_person.uuid, "other-person", "acme", "account-event", current_timestamp, 3
        )
        GroupUsageMetric.objects.create(
            team=other_team,
            group_type_index=self.group_type_index,
            name="Other team metric",
            format="numeric",
            interval=30,
            display="number",
            filters={"events": [{"id": "account-event", "type": "events", "order": 0}]},
        )
        flush_persons_and_events()

    def _capture_events(
        self,
        team: Team,
        person_id: UUID,
        distinct_id: str,
        account_id: str,
        event: str,
        timestamp: datetime,
        count: int,
    ) -> None:
        for index in range(count):
            _create_event(
                team=team,
                event=event,
                distinct_id=distinct_id,
                person_id=person_id,
                timestamp=timestamp + timedelta(seconds=index),
                properties={"$group_0": account_id},
            )

    def test_serializes_deterministic_scores_in_one_clickhouse_query(self) -> None:
        query = AccountsTableQuery(
            columns=[
                AccountsTableAccountFieldColumn(field=AccountsTableAccountField.NAME),
                AccountsTableTagsColumn(),
                AccountsTableNoteCountColumn(),
            ],
        )

        with patch(
            "products.customer_analytics.backend.hogql_queries.account_health.execute_hogql_query",
            wraps=execute_hogql_query,
        ) as execute_mock:
            response = AccountsTableQueryRunner(query=query, team=self.team, user=self.user).calculate()

        assert execute_mock.call_count == 1
        rows = {row.name: row for row in response.results}
        assert rows["Acme"].health.score == 70, [
            (factor.metricName, factor.current, factor.previous, factor.normalizedScore)
            for factor in rows["Acme"].health.factors
        ]
        assert rows["Acme"].health.status == "neutral"
        assert rows["Globex"].health.score == 100
        assert rows["Globex"].health.isLimited is True
        assert rows["Hooli"].health.noDataReason == "missing_external_id"
        assert [factor.metricName for factor in rows["Acme"].health.factors] == ["Active users", "Events ingested"]
        payload = response.model_dump(mode="json", by_alias=True)
        payload_rows = {row["name"]: row for row in payload["results"]}
        assert payload_rows["Acme"]["health"]["computedAt"] == "2026-05-21T12:00:00Z"
