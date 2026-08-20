import { LemonBanner, LemonTable, LemonTableColumns, LemonTag, Link } from '@posthog/lemon-ui'

import { TZLabel } from 'lib/components/TZLabel'
import { humanFriendlyNumber } from 'lib/utils/numbers'
import { urls } from 'scenes/urls'

import type { AccountHealthFactor, AccountHealthScore } from '~/queries/schema/schema-general'

import { ACCOUNT_HEALTH_NO_DATA_MESSAGE, ACCOUNT_HEALTH_STATUS_LABEL, accountHealthTagType } from './accountHealth'

const USAGE_METRICS_URL = `${urls.customerAnalyticsConfiguration()}?tab=customer-analytics-usage-metrics`

function formatMetricValue(value: number): string {
    return humanFriendlyNumber(value, 2)
}

export function AccountHealthDetails({ health }: { health: AccountHealthScore }): JSX.Element {
    if (health.status === 'no_data') {
        const message = health.noDataReason
            ? ACCOUNT_HEALTH_NO_DATA_MESSAGE[health.noDataReason]
            : 'There is not enough usage data to calculate a score.'
        return (
            <div className="flex flex-col gap-2 max-w-xl p-2" data-attr="account-health-no-data">
                <div className="flex items-center gap-2">
                    <h3 className="mb-0">Account health</h3>
                    <LemonTag type="muted">No data</LemonTag>
                </div>
                <p className="text-secondary mb-0">{message}</p>
                {health.noDataReason === 'no_metrics' ? <Link to={USAGE_METRICS_URL}>Set up usage metrics</Link> : null}
            </div>
        )
    }

    const columns: LemonTableColumns<AccountHealthFactor> = [
        {
            title: 'Usage metric',
            key: 'metricName',
            render: (_, factor) => <span className="font-medium">{factor.metricName}</span>,
        },
        {
            title: `Current ${health.lookbackDays} days`,
            key: 'current',
            align: 'right',
            render: (_, factor) => <span className="tabular-nums">{formatMetricValue(factor.current)}</span>,
        },
        {
            title: `Previous ${health.lookbackDays} days`,
            key: 'previous',
            align: 'right',
            render: (_, factor) => <span className="tabular-nums">{formatMetricValue(factor.previous)}</span>,
        },
        {
            title: 'Normalized',
            key: 'normalizedScore',
            align: 'right',
            render: (_, factor) => (
                <span className="tabular-nums">
                    {factor.normalizedScore == null ? 'Excluded' : `${factor.normalizedScore}/100`}
                </span>
            ),
        },
        {
            title: 'Contribution',
            key: 'contribution',
            align: 'right',
            render: (_, factor) => (
                <span className="tabular-nums">
                    {factor.contribution == null ? 'Excluded' : `+${factor.contribution.toFixed(1)}`}
                </span>
            ),
        },
    ]

    const includedScores = health.factors
        .map((factor) => factor.normalizedScore)
        .filter((score): score is number => typeof score === 'number')
    const formula = `mean(${includedScores.join(', ')}) = ${health.score}`
    const statusLabel = ACCOUNT_HEALTH_STATUS_LABEL[health.status]

    return (
        <div className="flex flex-col gap-3 p-1" data-attr="account-health-detail">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                    <span className="text-3xl font-bold tabular-nums">{health.score}</span>
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                            <h3 className="mb-0">Account health</h3>
                            <LemonTag type={accountHealthTagType(health.status)}>{statusLabel}</LemonTag>
                        </div>
                        <span className="text-sm text-secondary">
                            Current period started <TZLabel time={health.currentPeriodStart} />. Compared with the prior{' '}
                            {health.lookbackDays} days.
                        </span>
                    </div>
                </div>
                <span className="text-xs text-muted">
                    Calculated <TZLabel time={health.computedAt} />
                </span>
            </div>
            {health.isLimited ? (
                <LemonBanner type="warning">
                    This score has a limited baseline because at least one metric is new or has no activity in one
                    period.
                </LemonBanner>
            ) : null}
            <p className="text-sm text-secondary mb-0">
                Each metric scores current usage divided by previous usage, capped at 100. Metrics with no activity in
                either period are excluded. Available metrics have equal weight.
            </p>
            <LemonTable
                embedded
                size="small"
                rowKey="metricId"
                columns={columns}
                dataSource={health.factors}
                emptyState="No usage metrics were available."
            />
            <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono tabular-nums">{formula}</span>
                <span className="text-secondary">
                    {statusLabel} because the score is{' '}
                    {health.status === 'healthy'
                        ? '80 or higher.'
                        : health.status === 'neutral'
                          ? 'between 50 and 79.'
                          : 'below 50.'}
                </span>
            </div>
        </div>
    )
}
