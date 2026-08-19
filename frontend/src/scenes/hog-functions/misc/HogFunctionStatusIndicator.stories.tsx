import type { Meta, StoryObj } from '@storybook/react'

import { LemonSkeleton } from '@posthog/lemon-ui'

import { HogFunctionType, HogWatcherState } from '~/types'

import { expect, within } from 'storybook/test'

import { HogFunctionStatusIndicator } from './HogFunctionStatusIndicator'

const makeHogFunction = ({ enabled = true, state }: { enabled?: boolean; state?: HogWatcherState }): HogFunctionType =>
    ({
        id: `destination-${state ?? 'unknown'}-${enabled ? 'enabled' : 'paused'}`,
        enabled,
        type: 'destination',
        status: state === undefined ? null : { state, tokens: 0 },
    }) as HogFunctionType

const statusRows: { label: string; hogFunction: HogFunctionType }[] = [
    { label: 'Unknown', hogFunction: makeHogFunction({}) },
    { label: 'Healthy', hogFunction: makeHogFunction({ state: HogWatcherState.healthy }) },
    { label: 'Degraded', hogFunction: makeHogFunction({ state: HogWatcherState.overflowed }) },
    { label: 'Forcefully degraded', hogFunction: makeHogFunction({ state: HogWatcherState.forcefully_degraded }) },
    { label: 'Error-disabled', hogFunction: makeHogFunction({ state: HogWatcherState.disabled }) },
    { label: 'Forcefully disabled', hogFunction: makeHogFunction({ state: HogWatcherState.forcefully_disabled }) },
    { label: 'Paused manually', hogFunction: makeHogFunction({ enabled: false }) },
]

const meta: Meta<typeof HogFunctionStatusIndicator> = {
    title: 'Scenes-App/HogFunctions/Components/HogFunctionStatusIndicator',
    component: HogFunctionStatusIndicator,
    parameters: {
        a11y: { test: 'error' },
    },
}

export default meta
type Story = StoryObj<typeof HogFunctionStatusIndicator>

export const AllStates: Story = {
    args: {
        hogFunction: statusRows[0].hogFunction,
    },
    render: () => (
        <div className="flex flex-col gap-6 max-w-240 w-full p-4">
            <section aria-labelledby="destination-list-statuses">
                <h3 id="destination-list-statuses">Destination list</h3>
                <div className="rounded border bg-surface-primary">
                    <div className="grid grid-cols-2 gap-4 px-3 py-2 border-b font-semibold">
                        <span>State</span>
                        <span>Status</span>
                    </div>
                    {statusRows.map(({ label, hogFunction }) => (
                        <div
                            key={label}
                            className="grid grid-cols-2 gap-4 items-center px-3 py-2 border-b last:border-b-0"
                        >
                            <span>{label}</span>
                            <div className="flex">
                                <HogFunctionStatusIndicator hogFunction={hogFunction} />
                            </div>
                        </div>
                    ))}
                    <div className="grid grid-cols-2 gap-4 items-center px-3 py-2">
                        <span>Loading</span>
                        <LemonSkeleton className="w-16 h-5" />
                    </div>
                </div>
            </section>

            <section aria-labelledby="destination-detail-status">
                <h3 id="destination-detail-status">Destination detail</h3>
                <div className="flex items-center justify-between gap-4 rounded border bg-surface-primary p-3">
                    <span className="font-semibold">Status</span>
                    <HogFunctionStatusIndicator
                        hogFunction={makeHogFunction({ state: HogWatcherState.forcefully_degraded })}
                    />
                </div>
            </section>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)

        await expect(canvas.getAllByLabelText('Status: Active')).toHaveLength(2)
        await expect(canvas.getAllByLabelText('Status: Degraded')).toHaveLength(3)
        await expect(canvas.getAllByLabelText('Status: Disabled')).toHaveLength(2)
        await expect(canvas.getByLabelText('Status: Paused')).toBeVisible()

        for (const status of canvas.getAllByLabelText(/^Status:/)) {
            await expect(status).toHaveTextContent(/Active|Degraded|Disabled|Paused/)
            await expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
        }
    },
}
