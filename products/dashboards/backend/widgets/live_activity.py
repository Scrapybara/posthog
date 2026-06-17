from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from posthog.schema import DateRange, HogQLFilters, HogQLQuery

from posthog.clickhouse.query_tagging import Feature, Product, tags_context
from posthog.hogql_queries.hogql_query_runner import HogQLQueryRunner
from posthog.models.team import Team
from posthog.models.user import User

from products.dashboards.backend.widget_specs.configs import LIVE_ACTIVITY_WIDGET_TYPE
from products.dashboards.backend.widgets.config import resolve_filter_test_accounts

ValidatedLiveActivityWidgetConfig = dict[str, Any]

LIVE_ACTIVITY_WINDOW_SECONDS = 5 * 60
LIVE_ACTIVITY_BUCKET_SECONDS = 15
LIVE_ACTIVITY_BUCKET_COUNT = LIVE_ACTIVITY_WINDOW_SECONDS // LIVE_ACTIVITY_BUCKET_SECONDS
LIVE_ACTIVITY_DELAYED_AFTER_SECONDS = 60

LIVE_ACTIVITY_SUMMARY_QUERY = """
SELECT
    count() AS events_in_window,
    count(DISTINCT distinct_id) AS active_users,
    max(timestamp) AS latest_event_timestamp
FROM events
WHERE {filters}
"""

LIVE_ACTIVITY_PULSE_QUERY = """
SELECT
    intDiv(toUnixTimestamp(timestamp) - %(window_start_timestamp)d, %(bucket_seconds)d) AS bucket_index,
    count() AS events
FROM events
WHERE {filters}
GROUP BY bucket_index
HAVING bucket_index >= 0 AND bucket_index < %(bucket_count)d
ORDER BY bucket_index ASC
"""

LIVE_ACTIVITY_FEED_QUERY = """
SELECT
    uuid,
    event,
    distinct_id AS person_display_name,
    coalesce(properties.$current_url, properties.$screen_name, properties.$pathname) AS target,
    properties.$lib,
    timestamp,
    distinct_id
FROM events
WHERE {filters}
ORDER BY timestamp DESC
LIMIT %(limit)d
"""


def _query_values(generated_at: datetime, config: ValidatedLiveActivityWidgetConfig) -> dict[str, Any]:
    window_start = generated_at - timedelta(seconds=LIVE_ACTIVITY_WINDOW_SECONDS)
    return {
        "window_start_timestamp": int(window_start.timestamp()),
        "bucket_seconds": LIVE_ACTIVITY_BUCKET_SECONDS,
        "bucket_count": LIVE_ACTIVITY_BUCKET_COUNT,
        "limit": config["limit"],
    }


def _query_filters(team: Team, config: ValidatedLiveActivityWidgetConfig, generated_at: datetime) -> HogQLFilters:
    window_start = generated_at - timedelta(seconds=LIVE_ACTIVITY_WINDOW_SECONDS)
    return HogQLFilters(
        dateRange=DateRange(date_from=window_start.isoformat(), date_to=generated_at.isoformat()),
        filterTestAccounts=resolve_filter_test_accounts(config, team),
    )


def _run_hogql_query(
    team: Team,
    user: User | None,
    query: str,
    *,
    filters: HogQLFilters,
) -> list[list[Any]]:
    response = HogQLQueryRunner(
        team=team,
        query=HogQLQuery(query=query, filters=filters),
        user=user,
    ).calculate()
    raw_results = response.model_dump(mode="json").get("results")
    return raw_results if isinstance(raw_results, list) else []


def _format_live_activity_query(query: str, values: dict[str, Any]) -> str:
    return query % values


def _surface_for_event(event_name: str, lib: str | None, target: str | None) -> str:
    normalized_lib = (lib or "").lower()
    if event_name == "$screen" or any(
        token in normalized_lib for token in ("android", "ios", "react-native", "mobile")
    ):
        return "mobile"
    if (
        event_name == "$pageview"
        or normalized_lib in {"web", "js", "javascript"}
        or "web" in normalized_lib
        or bool(target and (target.startswith("http://") or target.startswith("https://") or target.startswith("/")))
    ):
        return "web"
    return "backend"


def _serialize_timestamp(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC).isoformat()
        return value.isoformat()
    if isinstance(value, str):
        if value.endswith("Z") or "+" in value[10:] or "-" in value[10:]:
            return value
        if "T" in value:
            return f"{value}+00:00"
        return value
    return str(value)


def _parse_serialized_timestamp(value: str | None) -> datetime | None:
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _feed_row_to_event(row: list[Any]) -> dict[str, Any]:
    uuid, event_name, display_name, target, lib, timestamp, distinct_id = (row + [None] * 7)[:7]
    event_name_str = str(event_name or "")
    lib_str = str(lib) if lib is not None else None
    target_str = str(target) if target is not None else None
    distinct_id_str = str(distinct_id) if distinct_id is not None else None
    display_name_str = str(display_name) if display_name is not None else None

    return {
        "uuid": str(uuid),
        "event": event_name_str,
        "person": (
            {
                "display_name": display_name_str or distinct_id_str,
                "distinct_id": distinct_id_str,
            }
            if display_name_str or distinct_id_str
            else None
        ),
        "target": target_str,
        "lib": lib_str,
        "surface": _surface_for_event(event_name_str, lib_str, target_str),
        "timestamp": _serialize_timestamp(timestamp),
    }


def _build_pulse(rows: list[list[Any]], window_start: datetime) -> list[dict[str, Any]]:
    counts_by_bucket: dict[int, int] = {}
    for row in rows:
        if len(row) < 2:
            continue
        try:
            bucket_index = int(row[0])
            count = int(row[1])
        except (TypeError, ValueError):
            continue
        if 0 <= bucket_index < LIVE_ACTIVITY_BUCKET_COUNT:
            counts_by_bucket[bucket_index] = count

    return [
        {
            "bucketStart": (window_start + timedelta(seconds=index * LIVE_ACTIVITY_BUCKET_SECONDS)).isoformat(),
            "count": counts_by_bucket.get(index, 0),
        }
        for index in range(LIVE_ACTIVITY_BUCKET_COUNT)
    ]


def _apply_feed_lower_bounds_to_pulse(
    pulse: list[dict[str, Any]], events: list[dict[str, Any]], window_start: datetime
) -> None:
    counts_by_bucket: dict[int, int] = {}
    window_end = window_start + timedelta(seconds=LIVE_ACTIVITY_WINDOW_SECONDS)
    for event in events:
        timestamp = _parse_serialized_timestamp(event.get("timestamp"))
        if timestamp is None or timestamp < window_start or timestamp >= window_end:
            continue
        bucket_index = int((timestamp - window_start).total_seconds() // LIVE_ACTIVITY_BUCKET_SECONDS)
        counts_by_bucket[bucket_index] = counts_by_bucket.get(bucket_index, 0) + 1

    for bucket_index, count in counts_by_bucket.items():
        if 0 <= bucket_index < len(pulse):
            pulse[bucket_index]["count"] = max(int(pulse[bucket_index]["count"]), count)


def _active_users_lower_bound(events: list[dict[str, Any]]) -> int:
    distinct_ids: set[str] = set()
    for event in events:
        person = event.get("person")
        if not isinstance(person, dict):
            continue
        distinct_id = person.get("distinct_id")
        if distinct_id:
            distinct_ids.add(str(distinct_id))
    return len(distinct_ids)


def _peak_events_per_minute(pulse: list[dict[str, Any]]) -> int:
    buckets_per_minute = 60 // LIVE_ACTIVITY_BUCKET_SECONDS
    counts = [int(bucket["count"]) for bucket in pulse]
    return max(
        (
            sum(counts[index : index + buckets_per_minute])
            for index in range(0, max(len(counts) - buckets_per_minute + 1, 1))
        ),
        default=0,
    )


def _summary_from_rows(rows: list[list[Any]]) -> tuple[int, int, str | None]:
    if not rows:
        return 0, 0, None
    row = rows[0]
    events_in_window = int(row[0] or 0) if len(row) > 0 else 0
    active_users = int(row[1] or 0) if len(row) > 1 else 0
    if events_in_window == 0:
        return 0, 0, None
    latest_event_timestamp = _serialize_timestamp(row[2]) if len(row) > 2 else None
    return events_in_window, active_users, latest_event_timestamp


def run_live_activity_widget(
    team: Team,
    config: dict[str, Any],
    user: User | None = None,
    *,
    include_total_count: bool = False,
) -> dict[str, Any]:
    # Registry imports this runner while building WIDGET_SPECS.
    from products.dashboards.backend.widget_specs.registry import validate_widget_config  # noqa: PLC0415

    typed_config = validate_widget_config(LIVE_ACTIVITY_WIDGET_TYPE, config)
    generated_at = datetime.now(UTC).replace(microsecond=0)
    window_start = generated_at - timedelta(seconds=LIVE_ACTIVITY_WINDOW_SECONDS)
    values = _query_values(generated_at, typed_config)
    filters = _query_filters(team, typed_config, generated_at)

    with tags_context(product=Product.PRODUCT_ANALYTICS, feature=Feature.QUERY, team_id=team.pk):
        summary_rows = _run_hogql_query(team, user, LIVE_ACTIVITY_SUMMARY_QUERY, filters=filters)
        pulse_rows = _run_hogql_query(
            team,
            user,
            _format_live_activity_query(LIVE_ACTIVITY_PULSE_QUERY, values),
            filters=filters,
        )
        feed_rows = _run_hogql_query(
            team,
            user,
            _format_live_activity_query(LIVE_ACTIVITY_FEED_QUERY, values),
            filters=filters,
        )

    events_in_window, active_users, latest_event_timestamp = _summary_from_rows(summary_rows)
    events = [_feed_row_to_event(row) for row in feed_rows]
    events_in_window = max(events_in_window, len(events))
    active_users = max(active_users, _active_users_lower_bound(events))
    if latest_event_timestamp is None and events:
        latest_event_timestamp = events[0]["timestamp"]
    pulse = _build_pulse(pulse_rows, window_start)
    _apply_feed_lower_bounds_to_pulse(pulse, events, window_start)

    return {
        "activeUsers": active_users,
        "eventsInWindow": events_in_window,
        "peakEventsPerMinute": _peak_events_per_minute(pulse),
        "pulse": pulse,
        "events": events,
        "limit": typed_config["limit"],
        "rollingWindowSeconds": LIVE_ACTIVITY_WINDOW_SECONDS,
        "bucketSeconds": LIVE_ACTIVITY_BUCKET_SECONDS,
        "refreshIntervalSeconds": typed_config["refreshIntervalSeconds"],
        "generatedAt": generated_at.isoformat(),
        "windowStart": window_start.isoformat(),
        "latestEventTimestamp": latest_event_timestamp,
        "delayedAfterSeconds": LIVE_ACTIVITY_DELAYED_AFTER_SECONDS,
    }
