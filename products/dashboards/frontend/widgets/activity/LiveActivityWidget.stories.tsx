import type { Meta, StoryObj } from '@storybook/react'

import { DashboardPlacement } from '~/types'

import { WidgetCard } from '../../components/WidgetCard/WidgetCard'
import { WidgetCardBody } from '../../components/WidgetCard/WidgetCardBody'
import { WidgetCardHeader, widgetCardShouldHideMoreButton } from '../../components/WidgetCard/WidgetCardHeader'
import {
    mockMoreOverlay,
    widgetStorybookParameters,
    widgetTileFrameDecorator,
} from '../../components/WidgetCard/widgetCardStoryFixtures'
import { getDashboardWidgetCatalogEntry, getDashboardWidgetGroupLabel } from '../../widget_types/catalog'
import type { DashboardWidgetComponentProps } from '../registry'
import { liveActivityDelayedResult, liveActivityEmptyResult, liveActivitySampleResult } from './liveActivitySampleData'
import { LiveActivityWidget } from './LiveActivityWidget'

const LIVE_ACTIVITY_CATALOG = getDashboardWidgetCatalogEntry('live_activity')
const DEFAULT_CONFIG = LIVE_ACTIVITY_CATALOG.defaultConfig as Record<string, unknown>

function LiveActivityWidgetTileStory({
    title = '',
    description = 'Active users, activity pulse, and recent events for the last 5 minutes.',
    showDescription = true,
    cardError,
    ...widgetProps
}: DashboardWidgetComponentProps & {
    title?: string
    description?: string
    showDescription?: boolean
    cardError?: string | null
}): JSX.Element {
    const widgetTypeLabel = getDashboardWidgetGroupLabel(LIVE_ACTIVITY_CATALOG.groupId)
    const defaultTitle = LIVE_ACTIVITY_CATALOG.headerTitle ?? LIVE_ACTIVITY_CATALOG.label

    return (
        <WidgetCard className="h-full">
            <WidgetCardHeader
                layout={LIVE_ACTIVITY_CATALOG.headerLayout}
                title={title}
                defaultTitle={defaultTitle}
                titleHref={LIVE_ACTIVITY_CATALOG.titleHref}
                widgetTypeLabel={widgetTypeLabel}
                config={widgetProps.config}
                headerMeta={LIVE_ACTIVITY_CATALOG.headerMeta}
                description={description}
                showDescription={showDescription}
                loading={widgetProps.loading}
                shouldHideMoreButton={widgetCardShouldHideMoreButton(DashboardPlacement.Dashboard, false)}
                moreButtonOverlay={mockMoreOverlay}
            />
            <WidgetCardBody error={cardError ?? undefined} onRefresh={widgetProps.onRefresh}>
                <LiveActivityWidget {...widgetProps} />
            </WidgetCardBody>
        </WidgetCard>
    )
}

const meta: Meta<typeof LiveActivityWidgetTileStory> = {
    title: 'Dashboards/Dashboard Widgets/Widget types/Activity/Live activity',
    component: LiveActivityWidgetTileStory,
    parameters: {
        layout: 'padded',
        ...widgetStorybookParameters,
    },
    decorators: [...widgetTileFrameDecorator],
    args: {
        tileId: 1,
        config: DEFAULT_CONFIG,
        loading: false,
        result: liveActivitySampleResult,
        onUpdateConfig: () => undefined,
        onRefresh: () => undefined,
        onRefreshData: () => undefined,
    },
}

export default meta

type Story = StoryObj<typeof LiveActivityWidgetTileStory>

export const Default: Story = {
    args: {
        title: 'Live activity',
        config: DEFAULT_CONFIG,
        loading: false,
        result: liveActivitySampleResult,
    },
}

export const Loading: Story = {
    args: {
        title: 'Live activity',
        config: DEFAULT_CONFIG,
        loading: true,
        result: null,
    },
    parameters: {
        testOptions: { waitForLoadersToDisappear: false },
    },
}

export const Empty: Story = {
    args: {
        title: 'Live activity',
        config: DEFAULT_CONFIG,
        loading: false,
        result: liveActivityEmptyResult,
    },
}

export const Delayed: Story = {
    args: {
        title: 'Live activity',
        config: DEFAULT_CONFIG,
        loading: false,
        result: liveActivityDelayedResult,
    },
}

export const Narrow: Story = {
    args: {
        title: 'Live activity',
        config: DEFAULT_CONFIG,
        loading: false,
        result: liveActivitySampleResult,
    },
    decorators: [
        (Story) => (
            <div className="w-[280px]">
                <Story />
            </div>
        ),
    ],
}

export const Error: Story = {
    args: {
        title: 'Live activity',
        config: DEFAULT_CONFIG,
        loading: false,
        result: liveActivitySampleResult,
        cardError: 'Live activity could not be refreshed.',
    },
}
