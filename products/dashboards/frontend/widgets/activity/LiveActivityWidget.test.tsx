import { MOCK_DEFAULT_TEAM } from 'lib/api.mock'

import '@testing-library/jest-dom'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { teamLogic } from 'scenes/teamLogic'

import { initKeaTests } from '~/test/init'

import { liveActivityDelayedResult, liveActivityEmptyResult, liveActivitySampleResult } from './liveActivitySampleData'
import { LiveActivityWidget } from './LiveActivityWidget'

const setHidden = (hidden: boolean): void => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (hidden ? 'hidden' : 'visible'),
    })
    document.dispatchEvent(new Event('visibilitychange'))
}

describe('LiveActivityWidget', () => {
    afterEach(() => {
        cleanup()
        jest.useRealTimers()
        setHidden(false)
    })

    beforeEach(() => {
        initKeaTests(true, { ...MOCK_DEFAULT_TEAM })
        teamLogic.mount()
        setHidden(false)
    })

    it('renders the active user metric, pulse, and bounded recent-events feed', () => {
        const { container } = render(
            <LiveActivityWidget
                tileId={1}
                config={{ limit: 5, refreshIntervalSeconds: 15 }}
                loading={false}
                result={liveActivitySampleResult}
            />
        )

        expect(screen.getByText('42')).toBeInTheDocument()
        expect(screen.getByText('active users')).toBeInTheDocument()
        expect(container.querySelectorAll('[data-attr="live-activity-widget-event-row"]')).toHaveLength(5)
        expect(screen.getByText('Signup completed')).toBeInTheDocument()
        expect(screen.getByText('Backend')).toBeInTheDocument()
        expect(screen.getByText('5 of 186 recent events')).toBeInTheDocument()
        expect(screen.getByLabelText('Activity pulse over the last 5 minutes')).toBeInTheDocument()
    })

    it('renders loading and narrow-layout affordances', () => {
        const { container, rerender } = render(
            <div className="w-[280px]">
                <LiveActivityWidget
                    tileId={1}
                    config={{ limit: 5, refreshIntervalSeconds: 15 }}
                    loading
                    result={null}
                />
            </div>
        )

        expect(container.querySelectorAll('.LemonSkeleton')).toHaveLength(7)

        rerender(
            <div className="w-[280px]">
                <LiveActivityWidget
                    tileId={1}
                    config={{ limit: 5, refreshIntervalSeconds: 15 }}
                    loading={false}
                    result={liveActivitySampleResult}
                />
            </div>
        )

        expect(screen.getByLabelText('Pause live activity refresh')).toBeInTheDocument()
        expect(container.querySelector('.\\@max-\\[360px\\]\\/widget-card\\:flex-col')).toBeInTheDocument()
    })

    it('renders empty and delayed states', () => {
        const { rerender, container } = render(
            <LiveActivityWidget
                tileId={1}
                config={{ limit: 5, refreshIntervalSeconds: 15 }}
                loading={false}
                result={liveActivityEmptyResult}
            />
        )

        expect(container.querySelector('[data-attr="live-activity-widget-empty-state"]')).toBeInTheDocument()
        expect(screen.getByText('No live activity yet')).toBeInTheDocument()

        rerender(
            <LiveActivityWidget
                tileId={1}
                config={{ limit: 5, refreshIntervalSeconds: 15 }}
                loading={false}
                result={liveActivityDelayedResult}
            />
        )

        expect(screen.getByText('Delayed')).toBeInTheDocument()
    })

    it('auto-refreshes on the configured interval, supports pause/resume, and pauses while hidden', () => {
        jest.useFakeTimers()
        const onRefresh = jest.fn()
        const onRefreshData = jest.fn()

        render(
            <LiveActivityWidget
                tileId={1}
                config={{ limit: 5, refreshIntervalSeconds: 15 }}
                loading={false}
                result={liveActivitySampleResult}
                onRefresh={onRefresh}
                onRefreshData={onRefreshData}
            />
        )

        act(() => jest.advanceTimersByTime(15000))
        expect(onRefreshData).toHaveBeenCalledTimes(1)
        expect(onRefresh).not.toHaveBeenCalled()

        fireEvent.click(screen.getByLabelText('Pause live activity refresh'))
        act(() => jest.advanceTimersByTime(30000))
        expect(onRefreshData).toHaveBeenCalledTimes(1)
        expect(screen.getByText('Paused')).toBeInTheDocument()

        fireEvent.click(screen.getByLabelText('Resume live activity refresh'))
        expect(onRefreshData).toHaveBeenCalledTimes(2)

        act(() => setHidden(true))
        act(() => jest.advanceTimersByTime(30000))
        expect(onRefreshData).toHaveBeenCalledTimes(2)

        act(() => setHidden(false))
        act(() => jest.advanceTimersByTime(15000))
        expect(onRefreshData).toHaveBeenCalledTimes(3)

        fireEvent.click(screen.getByLabelText('Refresh live activity now'))
        expect(onRefresh).toHaveBeenCalledTimes(1)
    })
})
