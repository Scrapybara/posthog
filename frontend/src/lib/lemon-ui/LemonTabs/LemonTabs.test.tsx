import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { LemonTabs } from './LemonTabs'

describe('LemonTabs', () => {
    afterEach(cleanup)

    test('moves focus and selection with tab navigation keys', () => {
        const onChange = jest.fn()

        render(
            <LemonTabs
                activeKey="inspector"
                onChange={onChange}
                tabs={[
                    { key: 'overview', label: 'Overview' },
                    { key: 'inspector', label: 'Inspector' },
                    { key: 'network', label: 'Network waterfall' },
                ]}
            />
        )

        const inspector = screen.getByText('Inspector').closest('[role="tab"]') as HTMLElement
        const network = screen.getByText('Network waterfall').closest('[role="tab"]') as HTMLElement

        inspector.focus()
        fireEvent.keyDown(inspector, { key: 'ArrowRight' })

        expect(document.activeElement).toBe(network)
        expect(onChange).toHaveBeenLastCalledWith('network')

        fireEvent.keyDown(network, { key: 'Home' })

        expect(document.activeElement).toBe(screen.getByText('Overview').closest('[role="tab"]'))
        expect(onChange).toHaveBeenLastCalledWith('overview')
    })

    test('scrolls a newly selected overflowing tab into view', () => {
        const { rerender } = render(
            <LemonTabs
                activeKey="overview"
                tabs={[
                    { key: 'overview', label: 'Overview' },
                    { key: 'inspector', label: 'Inspector' },
                    { key: 'network', label: 'Network waterfall' },
                ]}
            />
        )
        const tablist = screen.getByRole('tablist')
        const scrollTo = jest.fn()

        Object.defineProperties(tablist, {
            clientWidth: { configurable: true, value: 100 },
            scrollLeft: { configurable: true, value: 0 },
            scrollTo: { configurable: true, value: scrollTo },
        })

        const network = screen.getByText('Network waterfall').closest('[role="tab"]') as HTMLElement
        Object.defineProperties(network, {
            offsetLeft: { configurable: true, value: 160 },
            offsetWidth: { configurable: true, value: 80 },
        })

        rerender(
            <LemonTabs
                activeKey="network"
                tabs={[
                    { key: 'overview', label: 'Overview' },
                    { key: 'inspector', label: 'Inspector' },
                    { key: 'network', label: 'Network waterfall' },
                ]}
            />
        )

        expect(scrollTo).toHaveBeenCalledWith({ left: 140, behavior: 'smooth' })
    })
})
