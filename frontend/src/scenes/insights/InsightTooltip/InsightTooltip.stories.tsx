import type { Meta, StoryObj } from '@storybook/react'
import { useMountedLogic } from 'kea'

import { SeriesLetter } from 'lib/components/SeriesGlyph'
import { humanFriendlyNumber } from 'lib/utils'

import { cohortsModel } from '~/models/cohortsModel'
import { CompareLabelType, InsightType, IntervalType } from '~/types'

import { InsightTooltip } from './InsightTooltip'
import { InsightTooltipProps } from './insightTooltipUtils'

const data = {
    date: '2022-08-31',
    timezone: 'UTC',
    seriesData: [
        {
            id: 0,
            dataIndex: 7,
            datasetIndex: 2,
            dotted: true,
            action: {
                id: '$pageview',
                type: 'events',
                order: 0,
                name: '$pageview',
                custom_name: 'Pageview of people with very long names like this text',
                math: 'dau',
                math_property: null,
                math_group_type_index: null,
                properties: {},
            },
            label: '$pageview',
            color: '#1d4aff',
            count: 1,
        },
        {
            id: 1,
            dataIndex: 7,
            datasetIndex: 3,
            dotted: true,
            action: {
                id: 'filter added',
                type: 'events',
                order: 1,
                name: 'filter added',
                custom_name: null,
                math: null,
                math_property: null,
                math_group_type_index: null,
                properties: {},
            },
            label: 'filter added',
            color: '#621da6',
            count: 1,
        },
    ],
}

type Story = StoryObj<InsightTooltipProps>
const meta: Meta<InsightTooltipProps> = {
    title: 'Components/InsightTooltip',
    component: InsightTooltip,
    args: {
        date: data.date,
        timezone: data.timezone,
        seriesData: data.seriesData as any,
        hideColorCol: false,
        renderCount: (value: number): string => `${value}`,
        renderSeries: (value) => value,
        groupTypeLabel: 'people',
    },
    render: (props) => {
        useMountedLogic(cohortsModel)

        return <InsightTooltip {...props} />
    },
}
export default meta

export const Default: Story = {
    args: {},
}

export const Columns: Story = {
    args: {
        seriesData: [
            {
                id: 0,
                dataIndex: 3,
                datasetIndex: 2,
                order: 1,
                dotted: false,
                breakdown_value: 'Safari',
                action: {
                    days: [
                        '2025-05-29T00:00:00Z',
                        '2025-05-30T00:00:00Z',
                        '2025-05-31T00:00:00Z',
                        '2025-06-01T00:00:00Z',
                        '2025-06-02T00:00:00Z',
                        '2025-06-03T00:00:00Z',
                        '2025-06-04T00:00:00Z',
                        '2025-06-05T00:00:00Z',
                    ],
                    id: '$autocapture',
                    type: 'events',
                    order: 1,
                    name: '$autocapture',
                    custom_name: null,
                    math: 'total',
                    math_property: null,
                    math_hogql: null,
                    math_group_type_index: null,
                },
                label: '$autocapture - Safari',
                color: '#42827e',
                count: 0,
                filter: {
                    insight: InsightType.TRENDS,
                    properties: [],
                    filter_test_accounts: true,
                    date_to: '2025-06-05T23:59:59.999999Z',
                    date_from: '2025-05-29T00:00:00Z',
                    entity_type: 'events',
                    interval: 'day',
                    breakdown: '$browser',
                    breakdown_type: 'event',
                },
            },
            {
                id: 1,
                dataIndex: 3,
                datasetIndex: 0,
                order: 0,
                dotted: false,
                breakdown_value: 'Chrome',
                action: {
                    days: [
                        '2025-05-29T00:00:00Z',
                        '2025-05-30T00:00:00Z',
                        '2025-05-31T00:00:00Z',
                        '2025-06-01T00:00:00Z',
                        '2025-06-02T00:00:00Z',
                        '2025-06-03T00:00:00Z',
                        '2025-06-04T00:00:00Z',
                        '2025-06-05T00:00:00Z',
                    ],
                    id: '$pageview',
                    type: 'events',
                    order: 0,
                    name: '$pageview',
                    custom_name: 'Pageview of people with very long names like this text',
                    math: 'total',
                    math_property: null,
                    math_hogql: null,
                    math_group_type_index: null,
                },
                label: '$pageview - Chrome',
                color: '#1d4aff',
                count: 0,
                filter: {
                    insight: InsightType.TRENDS,
                    properties: [],
                    filter_test_accounts: true,
                    date_to: '2025-06-05T23:59:59.999999Z',
                    date_from: '2025-05-29T00:00:00Z',
                    entity_type: 'events',
                    interval: 'day',
                    breakdown: '$browser',
                    breakdown_type: 'event',
                },
            },
            {
                id: 2,
                dataIndex: 3,
                datasetIndex: 1,
                order: 0,
                dotted: false,
                breakdown_value: 'Safari',
                action: {
                    days: [
                        '2025-05-29T00:00:00Z',
                        '2025-05-30T00:00:00Z',
                        '2025-05-31T00:00:00Z',
                        '2025-06-01T00:00:00Z',
                        '2025-06-02T00:00:00Z',
                        '2025-06-03T00:00:00Z',
                        '2025-06-04T00:00:00Z',
                        '2025-06-05T00:00:00Z',
                    ],
                    id: '$pageview',
                    type: 'events',
                    order: 0,
                    name: '$pageview',
                    custom_name: 'Pageview of people with very long names like this text',
                    math: 'total',
                    math_property: null,
                    math_hogql: null,
                    math_group_type_index: null,
                },
                label: '$pageview - Safari',
                color: '#621da6',
                count: 0,
                filter: {
                    insight: InsightType.TRENDS,
                    properties: [],
                    filter_test_accounts: true,
                    date_to: '2025-06-05T23:59:59.999999Z',
                    date_from: '2025-05-29T00:00:00Z',
                    entity_type: 'events',
                    interval: 'day',
                    breakdown: '$browser',
                    breakdown_type: 'event',
                },
            },
        ],
    },
}

const compareAction = {
    id: '$pageview',
    type: 'events' as const,
    order: 0,
    name: '$pageview',
    custom_name: null,
    math: 'total' as const,
    math_property: null,
    math_group_type_index: null,
}

function compareSeriesData({
    currentDate,
    previousDate,
    breakdownValues = [undefined],
}: {
    currentDate: string
    previousDate: string
    breakdownValues?: (string | undefined)[]
}): InsightTooltipProps['seriesData'] {
    return breakdownValues.flatMap((breakdownValue, breakdownIndex) => [
        {
            id: breakdownIndex * 2,
            dataIndex: 0,
            datasetIndex: breakdownIndex * 2,
            order: 0,
            action: compareAction,
            label: breakdownValue ? `$pageview - ${breakdownValue}` : '$pageview',
            breakdown_value: breakdownValue,
            compare_label: CompareLabelType.Current,
            date: currentDate,
            color: '#1d4aff',
            count: 120 + breakdownIndex * 20,
        },
        {
            id: breakdownIndex * 2 + 1,
            dataIndex: 0,
            datasetIndex: breakdownIndex * 2 + 1,
            order: 0,
            action: compareAction,
            label: breakdownValue ? `$pageview - ${breakdownValue}` : '$pageview',
            breakdown_value: breakdownValue,
            compare_label: CompareLabelType.Previous,
            date: previousDate,
            color: '#1d4aff80',
            count: 84 + breakdownIndex * 16,
        },
    ])
}

function compareDateRange(date: string): { date_from: string; date_to: string } {
    return { date_from: `${date}T00:00:00Z`, date_to: `${date}T23:59:59Z` }
}

function compareTooltipArgs({
    interval,
    currentDate,
    previousDate,
    dateRange = compareDateRange(currentDate),
    compareDateRange: previousDateRange = compareDateRange(previousDate),
    timezone = 'UTC',
    breakdownValues,
}: {
    interval: IntervalType
    currentDate: string
    previousDate: string
    dateRange?: { date_from: string; date_to: string }
    compareDateRange?: { date_from: string; date_to: string }
    timezone?: string
    breakdownValues?: string[]
}): Partial<InsightTooltipProps> {
    return {
        date: currentDate,
        interval,
        timezone,
        dateRange,
        compareDateRange: previousDateRange,
        seriesData: compareSeriesData({ currentDate, previousDate, breakdownValues }),
    }
}

export const PreviousPeriodDay: Story = {
    args: compareTooltipArgs({
        interval: 'day',
        currentDate: '2025-06-12',
        previousDate: '2025-06-05',
    }),
}

export const PreviousPeriodWeek: Story = {
    args: compareTooltipArgs({
        interval: 'week',
        currentDate: '2025-06-09',
        previousDate: '2025-06-02',
        dateRange: { date_from: '2025-06-09T00:00:00Z', date_to: '2025-06-15T23:59:59Z' },
        compareDateRange: { date_from: '2025-06-02T00:00:00Z', date_to: '2025-06-08T23:59:59Z' },
    }),
}

export const PreviousPeriodMonth: Story = {
    args: compareTooltipArgs({
        interval: 'month',
        currentDate: '2025-06-01',
        previousDate: '2025-05-01',
        dateRange: { date_from: '2025-06-01T00:00:00Z', date_to: '2025-06-30T23:59:59Z' },
        compareDateRange: { date_from: '2025-05-01T00:00:00Z', date_to: '2025-05-31T23:59:59Z' },
    }),
}

export const PreviousPeriodYearBoundary: Story = {
    args: compareTooltipArgs({
        interval: 'day',
        currentDate: '2025-01-01',
        previousDate: '2024-12-31',
    }),
}

export const PreviousPeriodDst: Story = {
    args: compareTooltipArgs({
        interval: 'day',
        currentDate: '2024-03-17',
        previousDate: '2024-03-10',
        timezone: 'America/Los_Angeles',
        dateRange: { date_from: '2024-03-17T00:00:00-07:00', date_to: '2024-03-17T23:59:59-07:00' },
        compareDateRange: { date_from: '2024-03-10T00:00:00-08:00', date_to: '2024-03-10T23:59:59-07:00' },
    }),
}

export const PreviousPeriodBreakdowns: Story = {
    args: compareTooltipArgs({
        interval: 'day',
        currentDate: '2025-06-12',
        previousDate: '2025-06-05',
        breakdownValues: ['Chrome', 'Safari'],
    }),
}

const longBreakdownValue =
    'https://www.example.com/some/really/long/breakdown/value/that/keeps/going/and/going?utm_source=newsletter'
const anotherLongBreakdownValue =
    'https://www.example.com/another/extremely/long/path/segment/that/should/be/clipped/with/an/ellipsis'

// Demonstrates that long breakdown values (first column) and long series/event
// names (column headers) clip with an ellipsis instead of forcing the tooltip
// wide enough to need horizontal scrolling.
export const LongNames: Story = {
    args: {
        seriesData: [
            {
                id: 0,
                dataIndex: 3,
                datasetIndex: 0,
                order: 0,
                dotted: false,
                breakdown_value: longBreakdownValue,
                action: {
                    id: '$pageview',
                    type: 'events',
                    order: 0,
                    name: '$pageview',
                    custom_name: 'Pageview of people with extremely long custom names that go on and on and on',
                    math: 'total',
                    math_property: null,
                    math_hogql: null,
                    math_group_type_index: null,
                },
                label: '$pageview - long',
                color: '#1d4aff',
                count: 1234,
            },
            {
                id: 1,
                dataIndex: 3,
                datasetIndex: 1,
                order: 1,
                dotted: false,
                breakdown_value: longBreakdownValue,
                action: {
                    id: 'some_event_with_an_extremely_long_machine_readable_name_that_keeps_going',
                    type: 'events',
                    order: 1,
                    name: 'some_event_with_an_extremely_long_machine_readable_name_that_keeps_going',
                    custom_name: null,
                    math: 'total',
                    math_property: null,
                    math_hogql: null,
                    math_group_type_index: null,
                },
                label: 'some_event_with_an_extremely_long_machine_readable_name_that_keeps_going',
                color: '#621da6',
                count: 56,
            },
            {
                id: 2,
                dataIndex: 3,
                datasetIndex: 0,
                order: 0,
                dotted: false,
                breakdown_value: anotherLongBreakdownValue,
                action: {
                    id: '$pageview',
                    type: 'events',
                    order: 0,
                    name: '$pageview',
                    custom_name: 'Pageview of people with extremely long custom names that go on and on and on',
                    math: 'total',
                    math_property: null,
                    math_hogql: null,
                    math_group_type_index: null,
                },
                label: '$pageview - long',
                color: '#1d4aff',
                count: 789,
            },
            {
                id: 3,
                dataIndex: 3,
                datasetIndex: 1,
                order: 1,
                dotted: false,
                breakdown_value: anotherLongBreakdownValue,
                action: {
                    id: 'some_event_with_an_extremely_long_machine_readable_name_that_keeps_going',
                    type: 'events',
                    order: 1,
                    name: 'some_event_with_an_extremely_long_machine_readable_name_that_keeps_going',
                    custom_name: null,
                    math: 'total',
                    math_property: null,
                    math_hogql: null,
                    math_group_type_index: null,
                },
                label: 'some_event_with_an_extremely_long_machine_readable_name_that_keeps_going',
                color: '#621da6',
                count: 4,
            },
        ] as any,
    },
}

export function InWrapper(): JSX.Element {
    useMountedLogic(cohortsModel)

    return (
        <div className="min-h-50">
            <div className="InsightTooltipWrapper">
                <InsightTooltip
                    date={data.date}
                    timezone={data.timezone}
                    seriesData={data.seriesData as any}
                    renderCount={(value: number): string => humanFriendlyNumber(value)}
                    renderSeries={(value, datum) => {
                        const hasBreakdown = datum.breakdown_value !== undefined && !!datum.breakdown_value
                        return (
                            <div className="datum-label-column">
                                <SeriesLetter
                                    className="mr-2"
                                    hasBreakdown={hasBreakdown}
                                    seriesIndex={datum?.action?.order ?? datum.id}
                                    seriesColor={datum.color}
                                />
                                {value}
                            </div>
                        )
                    }}
                    groupTypeLabel="people"
                />
            </div>
        </div>
    )
}
// FIXME: InWrapper fails at locator.screenshot(), so it's skipped from visual regression
InWrapper.tags = ['test-skip']
