# Account health score v1

## Investigation

Issue [#57012](https://github.com/PostHog/posthog/issues/57012) asks for a global account health score built from usage and engagement metrics, with a visible breakdown on the expanded account.

Customer analytics already has the required account-to-product-usage bridge: `Account.external_id` is the configured account group key, and `UsageMetricsQueryRunner` evaluates team-owned `GroupUsageMetric` definitions against that group. Each metric already provides a current value and a previous-period value.

The Accounts list uses `AccountsTableQuery`, a typed Postgres query that returns one bounded page. Filters, saved views, overview tiles, and globally correct pagination sorting all compile into this query. Account access is fail-closed and team-scoped before rows are returned. Health must preserve that boundary and must not add a separate unscoped account lookup.

The existing usage metrics are the narrowest product-owned inputs for a prototype. They preserve each team's event definitions and avoid inventing generic events that may not represent customer value. Data warehouse usage metrics are excluded from v1 because their key and timestamp fields differ by source, so combining them into one bounded list query needs a separate performance design.

`GroupUsageMetric` does not currently assign a metric to a product. V1 therefore exposes one global score. Per-product scores remain deferred until product ownership is explicit instead of inferred from metric names.

## Scoring contract

- The score is an integer from 0 to 100.
- The lookback is the last 30 rolling days compared with the previous 30 days.
- The inputs are up to five valid event-based usage metrics, ordered by metric name and ID for deterministic selection.
- Each metric is normalized as `min(current / previous, 1) * 100`.
- A metric with current activity and no previous activity receives 100 normalized points and is marked as having a limited baseline.
- A metric with no activity in either period is unavailable and does not reduce the score.
- Available metrics have equal weight. Missing metrics are excluded and the remaining weights are renormalized.
- The visible contribution for each available factor is its normalized score divided by the number of available factors.
- A score from 80 to 100 is healthy, 50 to 79 is neutral, and 0 to 49 is at risk. These fixed thresholds make the labels mean “retaining at least 80%” and “retaining at least 50%” of the previous period on average. V1 does not add configurable weights or thresholds because Customer analytics has no existing configuration pattern for them.
- The score is calculated deterministically. No LLM is involved.

### Missing, sparse, and new-account data

- An account without an external ID has no score because it cannot be joined to product usage.
- A team without a configured account group type has no score.
- A team without supported event-based usage metrics has no score.
- An account with no activity across either 30-day period has no score rather than a zero score.
- An account with activity in only some configured metrics receives a score from those metrics and is marked as having a limited baseline.
- A new account with current activity but no previous-period activity receives a score, but the UI marks the baseline as limited. This keeps new activity visible without presenting it as a mature comparison.
- Calculation failures do not hide the account list. The account receives an unavailable state with retry guidance.

## UI concepts

Both concepts use the same deterministic healthy, neutral, at-risk, and no-data fixtures.

### Concept A: compact status

The table shows a colored circular number. Hovering shows a short tooltip, and the expanded row repeats the score in the existing narrow sidebar above useful links.

This is compact, but it makes the score easy to read as decoration. Tooltips are hard to compare, the sidebar cannot show all inputs comfortably, and the calculation is not part of the account's primary content.

### Concept B: auditable score

The table shows the number and status together. The cell opens a dedicated Health tab in the expanded account. That tab states the 30-day comparison, formula, included factor count, current and previous values, normalized points, and contribution for every metric. No-data and limited-baseline states explain why the result is unavailable or less certain.

This concept is selected because every number can be traced from the list to its inputs without relying on hover or color. Color is secondary to visible text, and the score link provides a keyboard-accessible path to the calculation.

## Computation and query boundary

V1 computes health at query time for the bounded account page returned by `AccountsTableQuery`.

- It avoids a model and migration before the score contract has production evidence.
- It issues at most one ClickHouse query for the page, regardless of row count or metric count.
- The ClickHouse query receives only the external IDs from the already team-scoped, access-filtered Postgres page.
- The metrics-only overview query does not calculate per-account health.
- Health filtering and sorting are not offered in v1. Calculating only the visible page cannot support globally correct ordering or filtering, and presenting a page-local approximation would be misleading.
- Persisting or materializing the score is deferred until query cost, update cadence, and global sort/filter requirements are measured.

## Local verification

Run `python manage.py seed_customer_analytics_accounts --team-id <team_id> --health-fixtures` to add four example accounts and a dedicated usage metric. The command sends fixed 90%, 60%, and 30% current-to-previous activity ratios for the healthy, neutral, and at-risk accounts. It sends no activity for the no-data account. Historical ingestion must finish before the scores appear in the Accounts list.
