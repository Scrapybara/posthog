import { Meta, StoryObj } from '@storybook/react'
import { BindLogic } from 'kea'
import { useState } from 'react'

import { insightLogic } from 'scenes/insights/insightLogic'

import { mswDecorator } from '~/mocks/browser'
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

const hideWeekendsSource = {
    kind: 'TrendsQuery',
    dateRange: { date_from: '2024-06-07', date_to: '2024-06-14' },
    interval: 'day',
    series: [{ kind: 'EventsNode', event: '$pageview', name: '$pageview' }],
    trendsFilter: { display: 'ActionsLineGraph', hideWeekends: true },
}

function makeHideWeekendsResult(hideWeekends: boolean): any {
    const days = hideWeekends
        ? ['2024-06-07', '2024-06-10', '2024-06-11', '2024-06-12', '2024-06-13', '2024-06-14']
        : [
              '2024-06-07',
              '2024-06-08',
              '2024-06-09',
              '2024-06-10',
              '2024-06-11',
              '2024-06-12',
              '2024-06-13',
              '2024-06-14',
          ]
    const labels = hideWeekends
        ? ['7-Jun-2024', '10-Jun-2024', '11-Jun-2024', '12-Jun-2024', '13-Jun-2024', '14-Jun-2024']
        : [
              '7-Jun-2024',
              '8-Jun-2024',
              '9-Jun-2024',
              '10-Jun-2024',
              '11-Jun-2024',
              '12-Jun-2024',
              '13-Jun-2024',
              '14-Jun-2024',
          ]
    const data = hideWeekends ? [1, 3, 3, 3, 12, 4] : [1, 2, 2, 3, 3, 3, 12, 4]

    return {
        ...trendsLineFixture.result[0],
        count: data.reduce((sum, value) => sum + value, 0),
        data,
        labels,
        days,
        action: {
            ...trendsLineFixture.result[0].action,
            days,
        },
    }
}

function makeHideWeekendsFixture(hideWeekends: boolean): any {
    return {
        ...trendsLineFixture,
        id: hideWeekends ? 61782 : 61781,
        short_id: hideWeekends ? 'hide-weekends-on' : 'hide-weekends-off',
        derived_name: hideWeekends ? 'Hide weekend data on' : 'Hide weekend data off',
        result: [makeHideWeekendsResult(hideWeekends)],
        query: {
            kind: 'InsightVizNode',
            source: {
                ...hideWeekendsSource,
                trendsFilter: { ...hideWeekendsSource.trendsFilter, hideWeekends },
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

export const HideWeekendsOff: Story = {
    render: () => renderTrendsLineChart(makeHideWeekendsFixture(false)),
}

export const HideWeekendsOn: Story = {
    render: () => renderTrendsLineChart(makeHideWeekendsFixture(true)),
}
