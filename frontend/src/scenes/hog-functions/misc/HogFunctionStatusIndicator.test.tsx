import '@testing-library/jest-dom'

import { cleanup, render, screen } from '@testing-library/react'

import { HogFunctionType, HogWatcherState } from '~/types'

import { HogFunctionStatusIndicator } from './HogFunctionStatusIndicator'

const makeHogFunction = (overrides: Partial<HogFunctionType> = {}): HogFunctionType =>
    ({
        id: 'hog-function-1',
        type: 'destination',
        name: 'HTTP Webhook',
        enabled: true,
        status: { state: HogWatcherState.healthy, tokens: 0 },
        ...overrides,
    }) as HogFunctionType

describe('HogFunctionStatusIndicator', () => {
    afterEach(cleanup)

    it.each([
        [HogWatcherState.healthy, 'Active', 'success'],
        [HogWatcherState.overflowed, 'Degraded', 'warning'],
        [HogWatcherState.disabled, 'Disabled', 'danger'],
        [HogWatcherState.forcefully_degraded, 'Degraded', 'warning'],
        [HogWatcherState.forcefully_disabled, 'Disabled', 'danger'],
    ])('renders a non-color status cue for watcher state %s', (state, label, tagType) => {
        render(<HogFunctionStatusIndicator hogFunction={makeHogFunction({ status: { state, tokens: 0 } })} />)

        const status = screen.getByRole('button', { name: `Function status: ${label}` })

        expect(status).toHaveTextContent(label)
        expect(status).toHaveClass(`LemonTag--${tagType}`)
        expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    })

    it('renders paused as a distinct disabled state', () => {
        render(<HogFunctionStatusIndicator hogFunction={makeHogFunction({ enabled: false })} />)

        const status = screen.getByRole('button', { name: 'Function status: Paused' })

        expect(status).toHaveTextContent('Paused')
        expect(status).toHaveClass('LemonTag--default')
        expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    })

    it('falls back to active with accessible text before watcher status is known', () => {
        render(<HogFunctionStatusIndicator hogFunction={makeHogFunction({ status: undefined })} />)

        const status = screen.getByRole('button', { name: 'Function status: Active' })

        expect(status).toHaveTextContent('Active')
        expect(status).toHaveClass('LemonTag--success')
    })

    it('does not render a status indicator for site destinations', () => {
        const { container } = render(
            <HogFunctionStatusIndicator hogFunction={makeHogFunction({ type: 'site_destination' })} />
        )

        expect(container).toBeEmptyDOMElement()
    })
})
