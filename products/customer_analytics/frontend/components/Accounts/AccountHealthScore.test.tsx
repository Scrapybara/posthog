import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import { AccountHealthScoreBadge, AccountHealthScoreExplanation, parseAccountHealthScore } from './AccountHealthScore'
import type { AccountHealthScore } from './AccountHealthScore'

const SCORE: AccountHealthScore = {
    score: 82,
    status: 'healthy',
    lookbackDays: 30,
    activityEvent: '$pageview',
    noDataReason: null,
    lastActivityAt: '2026-06-01T12:00:00Z',
    factors: [
        {
            key: 'activity',
            label: 'Activity volume',
            value: 120,
            previousValue: 80,
            score: 90,
            weight: 0.35,
            description: 'Activity events normalized against the account baseline.',
            reason: null,
        },
    ],
}

describe('AccountHealthScore', () => {
    it('parses valid serialized health score cells', () => {
        expect(parseAccountHealthScore(SCORE)).toEqual(SCORE)
        expect(parseAccountHealthScore({ status: 'healthy' })).toBeNull()
        expect(parseAccountHealthScore(null)).toBeNull()
    })

    it('renders an accessible table badge', () => {
        render(<AccountHealthScoreBadge score={SCORE} />)
        expect(screen.getByLabelText('Account health: 82 Healthy')).toBeInTheDocument()
    })

    it('renders auditable factor details', () => {
        render(<AccountHealthScoreExplanation score={SCORE} />)
        expect(screen.getByText('Health score')).toBeInTheDocument()
        expect(screen.getByText('Activity volume')).toBeInTheDocument()
        expect(screen.getByText('90/100')).toBeInTheDocument()
        expect(screen.getByText('35%')).toBeInTheDocument()
    })

    it('explains no-data scores', () => {
        render(
            <AccountHealthScoreExplanation
                score={{ ...SCORE, score: null, status: 'no_data', factors: [], noDataReason: 'No activity yet.' }}
            />
        )
        expect(screen.getByText('No score yet')).toBeInTheDocument()
        expect(screen.getByText('No activity yet.')).toBeInTheDocument()
    })
})
