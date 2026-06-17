import './HogFunctionStatusIndicator.stories.scss'

import type { Meta, StoryObj } from '@storybook/react'
import React from 'react'

import { LemonTag, Spinner } from '@posthog/lemon-ui'

import { HogFunctionType, HogWatcherState } from '~/types'

import { HogFunctionStatusIndicator } from './HogFunctionStatusIndicator'

type StatusFixture = {
    key: 'loading' | 'success' | 'warning' | 'disabled' | 'error'
    stateLabel: string
    displayedLabel: string
    ariaLabel: string
    shape: string
    tagType: React.ComponentProps<typeof LemonTag>['type']
    hogFunction?: HogFunctionType
}

const baseHogFunction = {
    id: 'hog-function-status-story',
    type: 'destination',
    name: 'HTTP Webhook',
    enabled: true,
    status: { state: HogWatcherState.healthy, tokens: 0 },
} as HogFunctionType

const statusFixtures: StatusFixture[] = [
    {
        key: 'loading',
        stateLabel: 'Loading',
        displayedLabel: 'Loading',
        ariaLabel: 'Function status: Loading',
        shape: '◌',
        tagType: 'muted',
    },
    {
        key: 'success',
        stateLabel: 'Success',
        displayedLabel: 'Active',
        ariaLabel: 'Function status: Active',
        shape: '●',
        tagType: 'success',
        hogFunction: baseHogFunction,
    },
    {
        key: 'warning',
        stateLabel: 'Warning',
        displayedLabel: 'Degraded',
        ariaLabel: 'Function status: Degraded',
        shape: '▲',
        tagType: 'warning',
        hogFunction: {
            ...baseHogFunction,
            id: 'hog-function-status-story-degraded',
            status: { state: HogWatcherState.overflowed, tokens: 0 },
        } as HogFunctionType,
    },
    {
        key: 'disabled',
        stateLabel: 'Disabled',
        displayedLabel: 'Paused',
        ariaLabel: 'Function status: Paused',
        shape: '◆',
        tagType: 'default',
        hogFunction: {
            ...baseHogFunction,
            id: 'hog-function-status-story-paused',
            enabled: false,
        } as HogFunctionType,
    },
    {
        key: 'error',
        stateLabel: 'Error',
        displayedLabel: 'Disabled',
        ariaLabel: 'Function status: Disabled',
        shape: '■',
        tagType: 'danger',
        hogFunction: {
            ...baseHogFunction,
            id: 'hog-function-status-story-disabled',
            status: { state: HogWatcherState.disabled, tokens: 0 },
        } as HogFunctionType,
    },
]

const meta: Meta = {
    title: 'Scenes-App/HogFunctions/Status Indicator',
    parameters: {
        layout: 'padded',
        viewMode: 'story',
    },
}
export default meta

type Story = StoryObj<{}>

function SelectedTreatmentTag({ fixture }: { fixture: StatusFixture }): JSX.Element {
    if (fixture.key === 'loading') {
        return (
            <LemonTag
                type="muted"
                icon={
                    <span aria-hidden="true">
                        <Spinner />
                    </span>
                }
                aria-label={fixture.ariaLabel}
                data-attr="hog-function-status-indicator"
            >
                {fixture.displayedLabel}
            </LemonTag>
        )
    }

    return <HogFunctionStatusIndicator hogFunction={fixture.hogFunction ?? null} />
}

function ShapeTreatmentTag({ fixture }: { fixture: StatusFixture }): JSX.Element {
    return (
        <LemonTag type={fixture.tagType} aria-label={fixture.ariaLabel}>
            <span aria-hidden="true" className="font-mono text-xs leading-none mr-0.5">
                {fixture.shape}
            </span>
            {fixture.displayedLabel}
        </LemonTag>
    )
}

function StatusTreatmentRows({ treatment }: { treatment: 'selected' | 'shape' }): JSX.Element {
    const Tag = treatment === 'selected' ? SelectedTreatmentTag : ShapeTreatmentTag

    return (
        <div className="grid gap-2" data-attr={`${treatment}-treatment`}>
            {statusFixtures.map((fixture) => (
                <div key={fixture.key} className="grid grid-cols-[5rem_auto] items-center gap-3">
                    <span className="text-xs font-semibold text-secondary">{fixture.stateLabel}</span>
                    <Tag fixture={fixture} />
                </div>
            ))}
        </div>
    )
}

function ComparisonPanel({
    title,
    className,
    children,
}: {
    title: string
    className?: string
    children?: React.ReactNode
}): JSX.Element {
    return (
        <section className={className}>
            <h3 className="text-sm font-semibold mb-2">{title}</h3>
            <div className="grid gap-4 rounded border bg-surface-primary p-3 md:grid-cols-2">
                <div>
                    <h4 className="text-xs font-semibold text-secondary mb-2">Icon label tag (selected)</h4>
                    <StatusTreatmentRows treatment="selected" />
                </div>
                <div>
                    <h4 className="text-xs font-semibold text-secondary mb-2">Shape glyph tag</h4>
                    <StatusTreatmentRows treatment="shape" />
                </div>
            </div>
            {children}
        </section>
    )
}

function DeuteranopiaFilter(): JSX.Element {
    return (
        <svg aria-hidden="true" className="absolute size-0">
            <filter id="hog-function-status-deuteranopia" colorInterpolationFilters="linearRGB">
                <feColorMatrix
                    type="matrix"
                    values="0.367 0.861 -0.228 0 0 0.28 0.673 0.047 0 0 -0.012 0.043 0.969 0 0 0 0 0 1 0"
                />
            </filter>
        </svg>
    )
}

function StatusTreatmentComparison(): JSX.Element {
    return (
        <div className="deprecated-space-y-4">
            <DeuteranopiaFilter />
            <p className="max-w-200 text-sm text-secondary">
                The icon label tag keeps the existing compact status tag shape, adds a distinct icon for each semantic
                state, and preserves visible text. The shape glyph alternative is smaller, but the glyphs are less
                recognizable when scanning a dense destination table.
            </p>
            <ComparisonPanel title="Normal" />
            <ComparisonPanel title="Deuteranopia simulated" className="HogFunctionStatusIndicatorStory__deuteranopia" />
            <ComparisonPanel title="High contrast simulation" className="contrast-150" />
        </div>
    )
}

export const TreatmentComparison: Story = {
    render: () => <StatusTreatmentComparison />,
    play: async ({ canvasElement }) => {
        for (const fixture of statusFixtures) {
            if (!canvasElement.querySelector(`[aria-label="${fixture.ariaLabel}"]`)) {
                throw new Error(`Missing accessible label for ${fixture.displayedLabel}`)
            }
        }

        if (
            canvasElement.querySelectorAll(
                '[data-attr="selected-treatment"] [data-attr="hog-function-status-indicator"] svg[aria-hidden="true"]'
            ).length < 4
        ) {
            throw new Error('Selected treatment must include decorative icons in addition to color and text')
        }
    },
}

export const DarkMode: Story = {
    render: () =>
        React.createElement(
            'div',
            {
                theme: 'dark',
                className: 'rounded bg-surface-primary p-4 text-default',
            } as React.HTMLAttributes<HTMLDivElement>,
            <StatusTreatmentComparison />
        ),
}
