import { render, screen } from '@testing-library/react'

import { AccountHealthExpansion } from './AccountHealthExpansion'

describe('AccountHealthExpansion', () => {
    it('renders configured factors when an account has no signal', () => {
        render(
            <AccountHealthExpansion
                health={{
                    score: null,
                    status: 'no_data',
                    factors: [
                        {
                            metric_id: 'events',
                            metric_name: 'Events ingested',
                            interval: 7,
                            current: 0,
                            previous: 0,
                            factor_score: null,
                            change_pct: null,
                        },
                    ],
                }}
            />
        )

        expect(screen.getByText('Events ingested')).toBeTruthy()
        expect(screen.getByText('No signal in either period')).toBeTruthy()
        expect(screen.queryByText('Set up usage metrics')).toBeNull()
    })
})
