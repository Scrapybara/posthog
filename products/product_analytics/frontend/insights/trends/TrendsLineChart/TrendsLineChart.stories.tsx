import { Meta, StoryObj } from '@storybook/react'
import { BindLogic } from 'kea'
import { useState } from 'react'

import {
    createInsightStory,
    insightSceneMswDecorator,
    insightSceneStoryParameters,
} from 'scenes/insights/__mocks__/createInsightScene'
import { insightLogic } from 'scenes/insights/insightLogic'

import { mswDecorator } from '~/mocks/browser'
import trendsAreaFixture from '~/mocks/fixtures/api/projects/team_id/insights/trendsArea.json'
import trendsAreaBreakdownFixture from '~/mocks/fixtures/api/projects/team_id/insights/trendsAreaBreakdown.json'
import trendsLineFixture from '~/mocks/fixtures/api/projects/team_id/insights/trendsLine.json'
import trendsLineBreakdownFixture from '~/mocks/fixtures/api/projects/team_id/insights/trendsLineBreakdown.json'
import trendsLineMultiFixture from '~/mocks/fixtures/api/projects/team_id/insights/trendsLineMulti.json'
import { dataNodeLogic } from '~/queries/nodes/DataNode/dataNodeLogic'
import type { DataNodeLogicProps } from '~/queries/nodes/DataNode/dataNodeLogic'
import { insightVizDataNodeKey } from '~/queries/nodes/InsightViz/InsightViz'
import { getCachedResults } from '~/queries/nodes/InsightViz/utils'
import { InsightLogicProps, InsightShortId } from '~/types'

import { TrendsLineChart } from './TrendsLineChart'

type Story = StoryObj<{}>

const deterministicDays = [
    '2024-06-07',
    '2024-06-08',
    '2024-06-09',
    '2024-06-10',
    '2024-06-11',
    '2024-06-12',
    '2024-06-13',
    '2024-06-14',
    '2024-06-15',
    '2024-06-16',
    '2024-06-17',
    '2024-06-18',
    '2024-06-19',
    '2024-06-20',
]
const deterministicLabels = [
    '7-Jun-2024',
    '8-Jun-2024',
    '9-Jun-2024',
    '10-Jun-2024',
    '11-Jun-2024',
    '12-Jun-2024',
    '13-Jun-2024',
    '14-Jun-2024',
    '15-Jun-2024',
    '16-Jun-2024',
    '17-Jun-2024',
    '18-Jun-2024',
    '19-Jun-2024',
    '20-Jun-2024',
]
const deterministicData = [1, 5, 6, 3, 3, 0, 2, 1, 4, 4, 3, 3, 3, 12]

function makeDeterministicFixture(weekdaysOnly: boolean): Record<string, unknown> {
    const keptIndices = deterministicDays.flatMap((day, index) => {
        const isoDay = new Date(`${day}T00:00:00Z`).getUTCDay()
        return !weekdaysOnly || (isoDay !== 0 && isoDay !== 6) ? [index] : []
    })
    const days = keptIndices.map((index) => deterministicDays[index])
    const labels = keptIndices.map((index) => deterministicLabels[index])
    const data = keptIndices.map((index) => deterministicData[index])

    return {
        ...trendsLineFixture,
        id: weekdaysOnly ? 61782 : 61781,
        short_id: weekdaysOnly ? 'weekdays-only' : 'all-days',
        derived_name: weekdaysOnly ? 'Weekdays only' : 'All days',
        result: [
            {
                ...trendsLineFixture.result[0],
                count: data.reduce((sum, value) => sum + value, 0),
                data,
                labels,
                days,
            },
        ],
        query: {
            ...trendsLineFixture.query,
            source: {
                ...trendsLineFixture.query.source,
                dateRange: {
                    date_from: '2024-06-07',
                    date_to: '2024-06-20',
                    daysOfWeek: weekdaysOnly ? [1, 2, 3, 4, 5] : undefined,
                },
                trendsFilter: {
                    ...trendsLineFixture.query.source.trendsFilter,
                    showValuesOnSeries: true,
                },
            },
        },
    }
}

const meta: Meta = {
    title: 'Insights/TrendsLineChart',
    component: TrendsLineChart,
    parameters: {
        layout: 'centered',
        mockDate: '2023-07-11',
        testOptions: { snapshotBrowsers: ['chromium'] },
    },
    decorators: [
        mswDecorator({
            get: {
                '/api/projects/:team_id/annotations/': {
                    count: 2,
                    next: null,
                    previous: null,
                    results: [
                        {
                            id: 1,
                            content: 'Marketing campaign launched',
                            date_marker: '2023-07-05T12:00:00Z',
                            creation_type: 'USR',
                            dashboard_item: null,
                            created_by: {
                                id: 1,
                                uuid: '0188cbcf-2391-0000-1868-14fb987285c5',
                                distinct_id: 'storybook-user',
                                first_name: 'Story',
                                email: 'story@posthog.com',
                            },
                            created_at: '2023-07-05T12:00:00Z',
                            updated_at: '2023-07-05T12:00:00Z',
                            deleted: false,
                            scope: 'organization',
                        },
                        {
                            id: 2,
                            content: 'Pricing page redesign shipped',
                            date_marker: '2023-07-08T12:00:00Z',
                            creation_type: 'USR',
                            dashboard_item: null,
                            created_by: {
                                id: 1,
                                uuid: '0188cbcf-2391-0000-1868-14fb987285c5',
                                distinct_id: 'storybook-user',
                                first_name: 'Story',
                                email: 'story@posthog.com',
                            },
                            created_at: '2023-07-08T12:00:00Z',
                            updated_at: '2023-07-08T12:00:00Z',
                            deleted: false,
                            scope: 'project',
                        },
                    ],
                },
            },
        }),
    ],
}
export default meta

let uniqueNode = 0

function Stage({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        // eslint-disable-next-line react/forbid-dom-props
        <div style={{ height: 360, width: 720, display: 'flex', flexDirection: 'column' }}>{children}</div>
    )
}

function renderTrendsLineChart(insightFixture: any): JSX.Element {
    const [dashboardItemId] = useState(() => `TrendsLineChartStory.${uniqueNode++}` as InsightShortId)
    const cachedInsight = { ...insightFixture, short_id: dashboardItemId }

    const insightProps: InsightLogicProps = { dashboardItemId, doNotLoad: true, cachedInsight }
    const dataNodeLogicProps: DataNodeLogicProps = {
        query: cachedInsight.query.source,
        key: insightVizDataNodeKey(insightProps),
        cachedResults: getCachedResults(cachedInsight, cachedInsight.query.source),
        doNotLoad: true,
    }

    return (
        <BindLogic logic={insightLogic} props={insightProps}>
            <BindLogic logic={dataNodeLogic} props={dataNodeLogicProps}>
                <Stage>
                    <TrendsLineChart />
                </Stage>
            </BindLogic>
        </BindLogic>
    )
}

export const Default: Story = {
    render: () => renderTrendsLineChart(trendsLineMultiFixture),
}

export const SingleSeries: Story = {
    render: () => renderTrendsLineChart(trendsLineFixture),
}

export const Breakdown: Story = {
    render: () => renderTrendsLineChart(trendsLineBreakdownFixture),
}

export const AllDays: Story = {
    name: 'All days',
    render: () => renderTrendsLineChart(makeDeterministicFixture(false)),
}

export const WeekdaysOnly: Story = {
    name: 'Weekdays only',
    render: () => renderTrendsLineChart(makeDeterministicFixture(true)),
}

// The area display renders through the same line chart component with filled series
export const Area: Story = {
    render: () => renderTrendsLineChart(trendsAreaFixture),
}

export const AreaBreakdown: Story = {
    render: () => renderTrendsLineChart(trendsAreaBreakdownFixture),
}

// Full insight scene in edit mode — the only snapshot of the editor's populated breakdown section
export const EditSceneBreakdown: Story = createInsightStory(trendsLineBreakdownFixture as any, 'edit')
EditSceneBreakdown.decorators = [insightSceneMswDecorator]
EditSceneBreakdown.parameters = {
    ...insightSceneStoryParameters,
    testOptions: {
        ...insightSceneStoryParameters.testOptions,
        waitForSelector: '[data-attr=trend-line-graph] > canvas',
    },
}
