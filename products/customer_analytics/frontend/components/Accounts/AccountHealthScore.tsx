export type AccountHealthStatus = 'healthy' | 'neutral' | 'at_risk' | 'no_data'

export type AccountHealthFactor = {
    key: string
    label: string
    value: number | string | null
    previousValue: number | string | null
    score: number | null
    weight: number
    description: string
    reason: string | null
}

export type AccountHealthScore = {
    score: number | null
    status: AccountHealthStatus
    lookbackDays: number
    activityEvent: string
    factors: AccountHealthFactor[]
    noDataReason: string | null
    lastActivityAt: string | null
}

const STATUS_LABELS: Record<AccountHealthStatus, string> = {
    healthy: 'Healthy',
    neutral: 'Neutral',
    at_risk: 'At risk',
    no_data: 'No data',
}

const STATUS_CLASSES: Record<AccountHealthStatus, string> = {
    healthy: 'border-success bg-success-highlight text-success',
    neutral: 'border-warning bg-warning-highlight text-warning',
    at_risk: 'border-danger bg-danger-highlight text-danger',
    no_data: 'border-border bg-bg-light text-muted',
}

function isNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
}

export function parseAccountHealthScore(value: unknown): AccountHealthScore | null {
    if (!value || typeof value !== 'object') {
        return null
    }
    const candidate = value as Partial<AccountHealthScore>
    if (
        !['healthy', 'neutral', 'at_risk', 'no_data'].includes(candidate.status ?? '') ||
        !isNumber(candidate.lookbackDays) ||
        typeof candidate.activityEvent !== 'string' ||
        !Array.isArray(candidate.factors)
    ) {
        return null
    }
    if (candidate.score !== null && candidate.score !== undefined && !isNumber(candidate.score)) {
        return null
    }
    return candidate as AccountHealthScore
}

function formatValue(value: number | string | null): string {
    if (value === null || value === undefined || value === '') {
        return '—'
    }
    if (typeof value === 'number') {
        return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1)
    }
    return value
}

function factorScoreLabel(score: number | null): string {
    return score === null ? 'Not scored' : `${score}/100`
}

export function AccountHealthScoreBadge({ score }: { score: AccountHealthScore | null }): JSX.Element {
    if (!score) {
        return <span className="text-muted">—</span>
    }
    const label = STATUS_LABELS[score.status]
    return (
        <span
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold tabular-nums ${STATUS_CLASSES[score.status]}`}
            aria-label={`Account health: ${score.score ?? 'no score'} ${label}`}
        >
            <span>{score.score ?? '—'}</span>
            <span>{label}</span>
        </span>
    )
}

export function AccountHealthScoreExplanation({ score }: { score: AccountHealthScore | null }): JSX.Element {
    if (!score || score.status === 'no_data') {
        return (
            <div className="rounded border bg-bg-light p-3" data-attr="account-health-no-data">
                <h4 className="secondary uppercase text-secondary mb-1">Health score</h4>
                <div className="font-semibold">No score yet</div>
                <p className="text-sm text-muted mb-0">
                    {score?.noDataReason ??
                        'This account does not have enough connected account activity to calculate a score.'}
                </p>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-3" data-attr="account-health-explanation">
            <div className={`rounded border p-3 ${STATUS_CLASSES[score.status]}`}>
                <h4 className="secondary uppercase mb-1">Health score</h4>
                <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold tabular-nums">{score.score}</span>
                    <span className="font-semibold">{STATUS_LABELS[score.status]}</span>
                </div>
                <p className="text-sm mb-0">
                    Last {score.lookbackDays} days of {score.activityEvent} activity. Query-time prototype; no LLMs, no
                    persisted score.
                </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {score.factors.map((factor) => (
                    <div key={factor.key} className="rounded border bg-bg-light p-3">
                        <div className="flex items-center justify-between gap-2">
                            <div className="font-semibold">{factor.label}</div>
                            <div className="font-mono text-sm tabular-nums">{factorScoreLabel(factor.score)}</div>
                        </div>
                        <div className="text-xs text-muted mb-2">{factor.description}</div>
                        <dl className="grid grid-cols-3 gap-2 text-xs mb-0">
                            <div>
                                <dt className="text-muted">Value</dt>
                                <dd className="font-semibold mb-0">{formatValue(factor.value)}</dd>
                            </div>
                            <div>
                                <dt className="text-muted">Previous</dt>
                                <dd className="font-semibold mb-0">{formatValue(factor.previousValue)}</dd>
                            </div>
                            <div>
                                <dt className="text-muted">Weight</dt>
                                <dd className="font-semibold mb-0">{Math.round(factor.weight * 100)}%</dd>
                            </div>
                        </dl>
                        {factor.reason ? <div className="text-xs text-muted mt-2">{factor.reason}</div> : null}
                    </div>
                ))}
            </div>
        </div>
    )
}
