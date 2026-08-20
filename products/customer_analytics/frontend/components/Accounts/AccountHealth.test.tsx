import '@testing-library/jest-dom'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'kea'

import type { AccountHealthScore } from '~/queries/schema/schema-general'
import { initKeaTests } from '~/test/init'

import { AccountHealthCell } from './AccountHealthCell'
import { AccountHealthDetails } from './AccountHealthDetails'
import { accountsExpansionLogic } from './accountsExpansionLogic'

const BASE_HEALTH: AccountHealthScore = {
    score: 80,
    status: 'healthy',
    isLimited: false,
    lookbackDays: 30,
    previousPeriodStart: '2026-03-22T00:00:00Z',
    currentPeriodStart: '2026-04-21T00:00:00Z',
    computedAt: '2026-05-21T00:00:00Z',
    factors: [
        {
            metricId: 'metric-events',
            metricName: 'Events ingested',
            current: 80,
            previous: 100,
            normalizedScore: 80,
            contribution: 80,
        },
    ],
}

type HealthStatus = AccountHealthScore['status']

const HEALTH_CASES: [HealthStatus, number | null, string][] = [
    ['healthy', 80, 'Healthy'],
    ['neutral', 60, 'Neutral'],
    ['at_risk', 30, 'At risk'],
    ['no_data', null, 'No data'],
]

describe('AccountHealth', () => {
    beforeEach(() => {
        initKeaTests()
        accountsExpansionLogic.mount()
    })

    afterEach(() => {
        cleanup()
        accountsExpansionLogic.unmount()
    })

    it.each(HEALTH_CASES)('renders an accessible %s state', (status, score, label) => {
        render(
            <Provider>
                <AccountHealthCell accountId="account-id" health={{ ...BASE_HEALTH, status, score }} />
            </Provider>
        )

        expect(screen.getByLabelText(new RegExp(label))).toBeInTheDocument()
    })

    it('opens the health explanation from the table cell', () => {
        render(
            <Provider>
                <AccountHealthCell accountId="account-id" health={BASE_HEALTH} />
            </Provider>
        )

        fireEvent.click(screen.getByLabelText('Health score: 80 out of 100, Healthy. View calculation.'))

        expect(accountsExpansionLogic.values.isAccountExpanded('account-id')).toBe(true)
        expect(accountsExpansionLogic.values.activeTabFor('account-id')).toBe('health')
    })

    it('explains the calculation and a limited baseline', () => {
        render(
            <AccountHealthDetails
                health={{
                    ...BASE_HEALTH,
                    isLimited: true,
                    factors: [
                        ...BASE_HEALTH.factors,
                        {
                            metricId: 'metric-users',
                            metricName: 'Active users',
                            current: 0,
                            previous: 0,
                            normalizedScore: null,
                            contribution: null,
                        },
                    ],
                }}
            />
        )

        expect(screen.getByText('mean(80) = 80')).toBeInTheDocument()
        expect(screen.getByText(/limited baseline/)).toBeInTheDocument()
        expect(screen.getAllByText('Excluded')).toHaveLength(2)
    })
})
