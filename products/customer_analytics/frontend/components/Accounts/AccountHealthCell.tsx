import { useActions, useValues } from 'kea'
import posthog from 'posthog-js'

import { LemonTag } from '@posthog/lemon-ui'

import { Link } from 'lib/lemon-ui/Link'
import { urls } from 'scenes/urls'

import type { AccountHealthScore } from '~/queries/schema/schema-general'

import { ACCOUNT_HEALTH_STATUS_LABEL, accountHealthTagType } from './accountHealth'
import { accountsExpansionLogic } from './accountsExpansionLogic'
import { AccountsEvents } from './constants'

export function AccountHealthCell({
    accountId,
    health,
}: {
    accountId: string
    health: AccountHealthScore
}): JSX.Element {
    const { isAccountExpanded } = useValues(accountsExpansionLogic)
    const { openAccountTab } = useActions(accountsExpansionLogic)
    const statusLabel = ACCOUNT_HEALTH_STATUS_LABEL[health.status]
    const scoreLabel = health.score === null ? 'No score' : `${health.score} out of 100`

    return (
        <Link
            to={urls.customerAnalyticsAccount(accountId, 'health')}
            aria-label={`Health score: ${scoreLabel}, ${statusLabel}. View calculation.`}
            data-attr="account-health-cell"
            className="inline-flex items-center gap-2"
            onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey) {
                    return
                }
                event.preventDefault()
                event.stopPropagation()
                if (!isAccountExpanded(accountId)) {
                    posthog.capture(AccountsEvents.AccountOpened)
                }
                openAccountTab(accountId, 'health')
                posthog.capture(AccountsEvents.TabViewed, { tab: 'health' })
            }}
        >
            <span className="font-semibold tabular-nums">{health.score === null ? 'No score' : health.score}</span>
            <LemonTag type={accountHealthTagType(health.status)} size="small">
                {statusLabel}
            </LemonTag>
        </Link>
    )
}
