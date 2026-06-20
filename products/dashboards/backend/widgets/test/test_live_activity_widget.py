from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from freezegun import freeze_time
from posthog.test.base import APIBaseTest, ClickhouseTestMixin, _create_event
from unittest.mock import MagicMock, patch

from products.dashboards.backend.widgets.live_activity import (
    LIVE_ACTIVITY_BUCKET_COUNT,
    LIVE_ACTIVITY_BUCKET_SECONDS,
    LIVE_ACTIVITY_DELAYED_AFTER_SECONDS,
    LIVE_ACTIVITY_WINDOW_SECONDS,
    _feed_row_to_event,
    _summary_from_rows,
    _surface_for_event,
    run_live_activity_widget,
)


class TestLiveActivityWidget(ClickhouseTestMixin, APIBaseTest):
    def _create_live_event(
        self,
        event: str,
        distinct_id: str,
        timestamp: datetime,
        properties: dict[str, Any] | None = None,
    ) -> str:
        return _create_event(
            team=self.team,
            event=event,
            distinct_id=distinct_id,
            timestamp=timestamp,
            properties=properties or {},
        )

    @freeze_time("2026-06-17T12:00:00Z")
    def test_returns_active_users_pulse_and_bounded_feed_for_recent_events(self) -> None:
        generated_at = datetime(2026, 6, 17, 12, 0, tzinfo=UTC)
        web_uuid = self._create_live_event(
            "$pageview",
            "user-a",
            generated_at - timedelta(seconds=10),
            {"$current_url": "https://example.test/pricing", "$lib": "web"},
        )
        mobile_uuid = self._create_live_event(
            "$screen",
            "user-b",
            generated_at - timedelta(seconds=20),
            {"$screen_name": "Checkout", "$lib": "posthog-ios"},
        )
        self._create_live_event(
            "Job completed",
            "user-a",
            generated_at - timedelta(seconds=35),
            {"$lib": "python"},
        )
        self._create_live_event(
            "$pageview",
            "outside-window",
            generated_at - timedelta(seconds=LIVE_ACTIVITY_WINDOW_SECONDS + 1),
            {"$current_url": "https://example.test/old", "$lib": "web"},
        )

        result = run_live_activity_widget(self.team, {"limit": 2, "refreshIntervalSeconds": 15}, self.user)

        assert result["activeUsers"] == 2
        assert result["eventsInWindow"] == 3
        assert result["limit"] == 2
        assert result["rollingWindowSeconds"] == LIVE_ACTIVITY_WINDOW_SECONDS
        assert result["bucketSeconds"] == LIVE_ACTIVITY_BUCKET_SECONDS
        assert result["delayedAfterSeconds"] == LIVE_ACTIVITY_DELAYED_AFTER_SECONDS
        assert result["generatedAt"] == "2026-06-17T12:00:00+00:00"
        assert result["windowStart"] == "2026-06-17T11:55:00+00:00"
        assert len(result["pulse"]) == LIVE_ACTIVITY_BUCKET_COUNT
        assert sum(bucket["count"] for bucket in result["pulse"]) == 3
        assert result["peakEventsPerMinute"] == 3

        assert [event["uuid"] for event in result["events"]] == [web_uuid, mobile_uuid]
        assert result["events"][0]["surface"] == "web"
        assert result["events"][0]["target"] == "https://example.test/pricing"
        assert result["events"][1]["surface"] == "mobile"
        assert result["events"][1]["target"] == "Checkout"
        assert result["latestEventTimestamp"] == "2026-06-17T11:59:50Z"

    @freeze_time("2026-06-17T12:00:00Z")
    def test_filter_test_accounts_follows_team_default_and_config_override(self) -> None:
        generated_at = datetime(2026, 6, 17, 12, 0, tzinfo=UTC)
        self.team.test_account_filters = [{"key": "$lib", "type": "event", "value": "web", "operator": "is_not"}]
        self.team.test_account_filters_default_checked = True
        self.team.save(update_fields=["test_account_filters", "test_account_filters_default_checked"])

        self._create_live_event(
            "$pageview",
            "test-account",
            generated_at - timedelta(seconds=10),
            {"$current_url": "https://example.test/internal", "$lib": "web"},
        )
        self._create_live_event(
            "Webhook processed",
            "real-account",
            generated_at - timedelta(seconds=20),
            {"$lib": "python"},
        )

        default_filtered = run_live_activity_widget(self.team, {"limit": 5}, self.user)
        unfiltered = run_live_activity_widget(self.team, {"limit": 5, "filterTestAccounts": False}, self.user)

        assert default_filtered["eventsInWindow"] == 1
        assert default_filtered["activeUsers"] == 1
        assert [event["event"] for event in default_filtered["events"]] == ["Webhook processed"]
        assert unfiltered["eventsInWindow"] == 2
        assert unfiltered["activeUsers"] == 2

    def test_surface_detection_covers_web_mobile_and_backend_events(self) -> None:
        assert _surface_for_event("$pageview", "web", "https://example.test") == "web"
        assert _surface_for_event("Screen viewed", "posthog-react-native", "Checkout") == "mobile"
        assert _surface_for_event("Webhook processed", "python", None) == "backend"

    def test_feed_row_serializes_person_and_surface_without_per_row_lookup(self) -> None:
        event = _feed_row_to_event(
            [
                "event-uuid",
                "$screen",
                None,
                "Checkout",
                "posthog-android",
                datetime(2026, 6, 17, 11, 59, 40, tzinfo=UTC),
                "user-b",
            ]
        )

        assert event == {
            "uuid": "event-uuid",
            "event": "$screen",
            "person": {"display_name": "user-b", "distinct_id": "user-b"},
            "target": "Checkout",
            "lib": "posthog-android",
            "surface": "mobile",
            "timestamp": "2026-06-17T11:59:40+00:00",
        }

    def test_summary_omits_latest_event_timestamp_when_window_is_empty(self) -> None:
        assert _summary_from_rows([[0, 0, datetime(1970, 1, 1, tzinfo=UTC)]]) == (0, 0, None)

    @freeze_time("2026-06-17T12:00:00Z")
    @patch("products.dashboards.backend.widgets.live_activity.HogQLQueryRunner")
    def test_feed_rows_provide_lower_bounds_when_aggregate_queries_lag(self, mock_runner_cls: MagicMock) -> None:
        def runner_side_effect(*_args: object, **kwargs: object) -> MagicMock:
            query = kwargs["query"]
            if "events_in_window" in query.query:
                results = [[1, 1, datetime(2026, 6, 17, 11, 59, 30, tzinfo=UTC)]]
            elif "bucket_index" in query.query:
                results = []
            else:
                results = [
                    [
                        "event-1",
                        "$pageview",
                        "user-a",
                        "https://example.test",
                        "web",
                        datetime(2026, 6, 17, 11, 59, 50, tzinfo=UTC),
                        "user-a",
                    ],
                    [
                        "event-2",
                        "Job completed",
                        "user-b",
                        None,
                        "python",
                        datetime(2026, 6, 17, 11, 59, 40, tzinfo=UTC),
                        "user-b",
                    ],
                ]
            return MagicMock(
                calculate=MagicMock(return_value=MagicMock(model_dump=lambda mode="json": {"results": results}))
            )

        mock_runner_cls.side_effect = runner_side_effect

        result = run_live_activity_widget(self.team, {"limit": 5, "refreshIntervalSeconds": 15}, self.user)

        assert result["eventsInWindow"] == 2
        assert result["activeUsers"] == 2
        assert result["latestEventTimestamp"] == "2026-06-17T11:59:50+00:00"
        assert sum(bucket["count"] for bucket in result["pulse"]) == 2
