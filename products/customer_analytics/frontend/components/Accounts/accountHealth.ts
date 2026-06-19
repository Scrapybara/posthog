import type { LemonTagType } from '@posthog/lemon-ui'

import type { AccountHealthFactor, AccountHealthScore, AccountHealthStatus } from '~/queries/schema/schema-general'

// Score thresholds, mirrored from the backend (products/customer_analytics/backend/services/account_health.py).
export const HEALTHY_THRESHOLD = 80
export const NEEDS_ATTENTION_THRESHOLD = 50

const VALID_STATUSES: AccountHealthStatus[] = ['healthy', 'needs_attention', 'at_risk', 'no_data']

export const HEALTH_STATUS_LABEL: Record<AccountHealthStatus, string> = {
    healthy: 'Healthy',
    needs_attention: 'Needs attention',
    at_risk: 'At risk',
    no_data: 'No data',
}

export function healthStatusTagType(status: AccountHealthStatus): LemonTagType {
    switch (status) {
        case 'healthy':
            return 'success'
        case 'needs_attention':
            return 'warning'
        case 'at_risk':
            return 'danger'
        default:
            return 'muted'
    }
}

// CSS color for a 0–100 score (overall or per-factor progress), bucketed by the same thresholds.
export function healthScoreColor(score: number | null): string {
    if (score === null) {
        return 'var(--color-text-tertiary)'
    }
    if (score >= HEALTHY_THRESHOLD) {
        return 'var(--color-success)'
    }
    if (score >= NEEDS_ATTENTION_THRESHOLD) {
        return 'var(--color-warning)'
    }
    return 'var(--color-danger)'
}

function asNumberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseFactor(value: unknown): AccountHealthFactor | null {
    if (!value || typeof value !== 'object') {
        return null
    }
    const factor = value as Record<string, unknown>
    if (typeof factor.metric_id !== 'string' || typeof factor.metric_name !== 'string') {
        return null
    }
    return {
        metric_id: factor.metric_id,
        metric_name: factor.metric_name,
        interval: typeof factor.interval === 'number' ? factor.interval : 0,
        current: typeof factor.current === 'number' ? factor.current : 0,
        previous: typeof factor.previous === 'number' ? factor.previous : 0,
        factor_score: asNumberOrNull(factor.factor_score),
        change_pct: asNumberOrNull(factor.change_pct),
    }
}

// Parse the synthetic `health_score` cell the backend injects into account rows. Returns null for
// anything that isn't a recognizable AccountHealthScore so callers can fall back gracefully.
export function parseAccountHealth(value: unknown): AccountHealthScore | null {
    if (!value || typeof value !== 'object') {
        return null
    }
    const cell = value as Record<string, unknown>
    const status = cell.status
    if (typeof status !== 'string' || !VALID_STATUSES.includes(status as AccountHealthStatus)) {
        return null
    }
    const factors = Array.isArray(cell.factors)
        ? cell.factors.map(parseFactor).filter((factor): factor is AccountHealthFactor => factor !== null)
        : []
    return {
        score: asNumberOrNull(cell.score),
        status: status as AccountHealthStatus,
        factors,
    }
}
