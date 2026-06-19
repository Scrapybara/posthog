import { TooltipItem } from 'lib/Chart'

import { createTooltipData } from './tooltip-data'

function tooltipItem(dataset: Record<string, any>, dataIndex = 0, datasetIndex = 0): TooltipItem<any> {
    return {
        dataIndex,
        datasetIndex,
        dataset,
    } as TooltipItem<any>
}

describe('createTooltipData', () => {
    it.each([
        ['day interval', '2024-06-03', 'day', 'UTC', '3 Jun 2024'],
        ['month interval', '2024-02-01', 'month', 'UTC', 'February 2024'],
        ['timezone boundary', '2024-04-28T23:30:00Z', 'day', 'Asia/Tokyo', '29 Apr 2024'],
    ])('formats compare date labels for %s', (_, day, interval, timezone, expectedDateLabel) => {
        const data = createTooltipData(
            [
                tooltipItem({
                    data: [10],
                    days: [day],
                    label: '$pageview',
                    compare: true,
                    compare_label: 'previous',
                }),
            ],
            undefined,
            { interval: interval as any, timezone }
        )

        expect(data[0].date_label).toBe(expectedDateLabel)
    })

    it('formats week interval labels as actual date ranges', () => {
        const data = createTooltipData(
            [
                tooltipItem({
                    data: [10],
                    days: ['2024-04-28'],
                    label: '$pageview',
                    compare: true,
                    compare_label: 'previous',
                }),
            ],
            undefined,
            { interval: 'week', timezone: 'UTC' }
        )

        expect(data[0].date_label).toBe('28 Apr - 4 May 2024')
    })

    it('respects explicit date boundaries for weekly labels', () => {
        const data = createTooltipData(
            [
                tooltipItem({
                    data: [10],
                    days: ['2024-04-30'],
                    label: '$pageview',
                    compare: true,
                    compare_label: 'current',
                }),
            ],
            undefined,
            {
                interval: 'week',
                timezone: 'UTC',
                dateRange: { date_from: '2024-04-30', date_to: '2024-05-02' },
            }
        )

        expect(data[0].date_label).toBe('30 Apr - 2 May 2024')
    })

    it('falls back to backend labels when a dataset has no day values', () => {
        const data = createTooltipData([
            tooltipItem({
                data: [10],
                labels: ['3-Jun-2024'],
                label: '$pageview',
                compare: true,
                compare_label: 'previous',
            }),
        ])

        expect(data[0].date_label).toBe('3-Jun-2024')
    })
})
