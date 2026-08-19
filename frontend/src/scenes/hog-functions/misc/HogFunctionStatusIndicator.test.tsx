import '@testing-library/jest-dom'

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { HogFunctionType, HogWatcherState } from '~/types'

import { HogFunctionStatusIndicator } from './HogFunctionStatusIndicator'

const makeHogFunction = ({
    enabled = true,
    state,
    type = 'destination',
}: {
    enabled?: boolean
    state?: HogWatcherState
    type?: HogFunctionType['type']
}): HogFunctionType =>
    ({
        id: 'destination-id',
        enabled,
        type,
        status: state === undefined ? null : { state, tokens: 0 },
    }) as HogFunctionType

describe('HogFunctionStatusIndicator', () => {
    afterEach(cleanup)

    it.each([
        ['unknown', undefined, 'Active'],
        ['healthy', HogWatcherState.healthy, 'Active'],
        ['degraded', HogWatcherState.overflowed, 'Degraded'],
        ['disabled', HogWatcherState.disabled, 'Disabled'],
        ['forcefully degraded', HogWatcherState.forcefully_degraded, 'Degraded'],
        ['forcefully disabled', HogWatcherState.forcefully_disabled, 'Disabled'],
    ])('renders the %s state with text, a shape, and an accessible name', (_, state, display) => {
        render(<HogFunctionStatusIndicator hogFunction={makeHogFunction({ state })} />)

        const status = screen.getByLabelText(`Status: ${display}`)

        expect(status).toHaveTextContent(display)
        expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    })

    it('distinguishes a manually paused destination from an error-disabled destination', () => {
        render(<HogFunctionStatusIndicator hogFunction={makeHogFunction({ enabled: false })} />)

        expect(screen.getByLabelText('Status: Paused')).toHaveTextContent('Paused')
        expect(screen.queryByLabelText('Status: Disabled')).not.toBeInTheDocument()
    })

    it('keeps the detailed explanation supplementary to the visible status', async () => {
        const user = userEvent.setup()
        render(
            <HogFunctionStatusIndicator hogFunction={makeHogFunction({ state: HogWatcherState.forcefully_degraded })} />
        )

        expect(screen.queryByText(/separate processing queue/)).not.toBeInTheDocument()
        await user.click(screen.getByLabelText('Status: Degraded'))
        expect(await screen.findByText(/separate processing queue/)).toBeVisible()
    })

    it.each(['site_destination', 'site_app'] as const)('does not show a status for %s functions', (type) => {
        const { container } = render(<HogFunctionStatusIndicator hogFunction={makeHogFunction({ type })} />)

        expect(container).toBeEmptyDOMElement()
    })
})
