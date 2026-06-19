import { LemonTag, Link } from '@posthog/lemon-ui'

import { LemonProgress } from 'lib/lemon-ui/LemonProgress'
import { humanFriendlyNumber } from 'lib/utils'
import { urls } from 'scenes/urls'

import type { AccountHealthFactor, AccountHealthScore } from '~/queries/schema/schema-general'

import { HEALTH_STATUS_LABEL, healthScoreColor, healthStatusTagType } from './accountHealth'

// Where to send users to define usage metrics when there's nothing to score against.
const USAGE_METRICS_CONFIG_URL = `${urls.customerAnalyticsConfiguration()}?tab=customer-analytics-usage-metrics`

function formatValue(value: number): string {
    return humanFriendlyNumber(value, 2)
}

function FactorTrend({ factor }: { factor: AccountHealthFactor }): JSX.Element {
    if (factor.factor_score === null) {
        return <span className="text-xs text-tertiary">No signal in either period</span>
    }
    if (factor.change_pct === null) {
        // Usage this period with no prior baseline — brand new.
        return <span className="text-xs font-medium text-success">New this period</span>
    }
    const up = factor.change_pct >= 0
    return (
        <span className={`text-xs font-medium ${up ? 'text-success' : 'text-danger'}`}>
            {`${up ? '+' : ''}${Math.round(factor.change_pct)}%`}
        </span>
    )
}

function FactorCard({ factor }: { factor: AccountHealthFactor }): JSX.Element {
    const score = factor.factor_score
    const color = healthScoreColor(score)
    return (
        <div
            className="flex flex-col gap-2 p-3 border border-border rounded bg-surface-primary"
            data-attr="account-health-factor"
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col">
                    <span className="font-medium">{factor.metric_name}</span>
                    <span className="text-xs text-muted">{`${factor.interval}-day window`}</span>
                </div>
                <span
                    className="text-lg font-semibold tabular-nums"
                    // eslint-disable-next-line react/forbid-dom-props
                    style={{ color }}
                >
                    {score === null ? '—' : score}
                </span>
            </div>
            <LemonProgress percent={score ?? 0} strokeColor={color} />
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted tabular-nums">
                    {`${formatValue(factor.current)} now · ${formatValue(factor.previous)} before`}
                </span>
                <FactorTrend factor={factor} />
            </div>
        </div>
    )
}

function NoHealthData(): JSX.Element {
    return (
        <div className="flex flex-col gap-2 p-4 max-w-xl">
            <h4 className="mb-0">Account health</h4>
            <p className="text-secondary mb-0">
                We don't have enough usage data to score this account yet. Health scores are derived from the activity
                measured by your team's usage metrics.
            </p>
            <Link to={USAGE_METRICS_CONFIG_URL}>Set up usage metrics</Link>
        </div>
    )
}

export function AccountHealthExpansion({ health }: { health: AccountHealthScore | null }): JSX.Element {
    if (!health || (health.status === 'no_data' && health.factors.length === 0)) {
        return <NoHealthData />
    }

    const score = health.score
    const color = healthScoreColor(score)

    return (
        <div className="flex flex-col gap-4 p-1" data-attr="account-health-detail">
            <div className="flex items-center gap-4">
                <div className="flex flex-col items-center justify-center w-24 shrink-0">
                    <span
                        className="text-3xl font-bold tabular-nums leading-none"
                        // eslint-disable-next-line react/forbid-dom-props
                        style={{ color }}
                    >
                        {score ?? '—'}
                    </span>
                    <span className="text-xs text-muted">out of 100</span>
                </div>
                <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h4 className="mb-0">Account health</h4>
                        <LemonTag type={healthStatusTagType(health.status)}>
                            {HEALTH_STATUS_LABEL[health.status]}
                        </LemonTag>
                    </div>
                    <p className="text-xs text-secondary mb-0 max-w-prose">
                        Each factor is how much of the previous period's usage was retained this period (current ÷
                        previous, capped at 100). The overall score is the average of the factor scores.
                    </p>
                </div>
            </div>
            <div className="grid grid-cols-1 @md:grid-cols-2 gap-3">
                {health.factors.map((factor) => (
                    <FactorCard key={factor.metric_id} factor={factor} />
                ))}
            </div>
        </div>
    )
}
