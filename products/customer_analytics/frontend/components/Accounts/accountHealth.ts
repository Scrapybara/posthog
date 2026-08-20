import type { LemonTagType } from '@posthog/lemon-ui'

import type { AccountHealthNoDataReason, AccountHealthStatus } from '~/queries/schema/schema-general'

export const ACCOUNT_HEALTH_COLUMN = 'health'

export const ACCOUNT_HEALTH_STATUS_LABEL: Record<AccountHealthStatus, string> = {
    healthy: 'Healthy',
    neutral: 'Neutral',
    at_risk: 'At risk',
    no_data: 'No data',
}

export const ACCOUNT_HEALTH_NO_DATA_MESSAGE: Record<AccountHealthNoDataReason, string> = {
    missing_external_id: "This account isn't linked to product usage.",
    missing_group_type: "Customer analytics isn't linked to an account group.",
    no_metrics: 'No supported usage metrics are configured.',
    no_activity: 'The configured metrics had no activity in either comparison period.',
    calculation_error: "The score couldn't be calculated. Refresh the page to try again.",
}

export function accountHealthTagType(status: AccountHealthStatus): LemonTagType {
    if (status === 'healthy') {
        return 'success'
    }
    if (status === 'neutral') {
        return 'warning'
    }
    if (status === 'at_risk') {
        return 'danger'
    }
    return 'muted'
}
