import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
    getDatumTitle,
    getFormattedCompareLabel,
    getFormattedDate,
} from 'scenes/insights/InsightTooltip/insightTooltipUtils'

import { CompareLabelType, IntervalType } from '~/types'

describe('getFormattedDate', () => {
    const paramsToExpectedWithNumericInput: [number, IntervalType, string][] = [
        [1, 'minute', '1 minute'],
        [2, 'minute', '2 minutes'],
        [1, 'hour', '1 hour'],
        [2, 'hour', '2 hours'],
        [1, 'day', '1 day'],
        [2, 'day', '2 days'],
        [1, 'week', '1 week'],
        [2, 'week', '2 weeks'],
        [1, 'month', '1 month'],
        [2, 'month', '2 months'],
    ]

    paramsToExpectedWithNumericInput.forEach(([input, interval, expected]) => {
        it(`expects "${expected}" for numeric input "${input}" and interval "${interval}"`, () => {
            expect(getFormattedDate(input, { interval })).toEqual(expected)
        })
    })

    describe('with date string inputs', () => {
        it('formats day intervals correctly', () => {
            expect(getFormattedDate('2024-04-28', { interval: 'day' })).toEqual('28 Apr 2024')
            expect(getFormattedDate('2024-05-12', { interval: 'day' })).toEqual('12 May 2024')
        })

        it('formats hour intervals correctly', () => {
            expect(getFormattedDate('2024-04-28T15:30:00', { interval: 'hour' })).toEqual('28 Apr 2024 15:00')
        })

        it('formats minute intervals correctly', () => {
            expect(getFormattedDate('2024-04-28T15:30:00', { interval: 'minute' })).toEqual('28 Apr 2024 15:30:00')
        })

        it('formats month intervals correctly', () => {
            expect(getFormattedDate('2024-04-28', { interval: 'month' })).toEqual('April 2024')
        })
    })

    describe('with week intervals', () => {
        it('formats full week ranges correctly', () => {
            expect(getFormattedDate('2024-04-28', { interval: 'week' })).toEqual('28 Apr - 4 May 2024')
        })

        it('handles Monday as start of week', () => {
            expect(getFormattedDate('2024-04-24', { interval: 'week', weekStartDay: 1 })).toEqual('22-28 Apr 2024')
        })

        it('handles bounded date ranges within a week', () => {
            expect(
                getFormattedDate('2024-04-25', {
                    interval: 'week',
                    dateRange: { date_from: '2024-04-23', date_to: '2024-04-27' },
                })
            ).toEqual('23-27 Apr 2024')
        })

        it('handles ranges across month boundaries', () => {
            expect(
                getFormattedDate('2024-04-30', {
                    interval: 'week',
                    dateRange: { date_from: '2024-04-29', date_to: '2024-05-05' },
                })
            ).toEqual('29 Apr - 4 May 2024')
        })

        it('handles ranges across year boundaries', () => {
            expect(
                getFormattedDate('2024-12-30', {
                    interval: 'week',
                    dateRange: { date_from: '2024-12-29', date_to: '2025-01-04' },
                })
            ).toEqual('29 Dec 2024 - 4 Jan 2025')
        })

        it('respects date range boundaries', () => {
            expect(
                getFormattedDate('2024-04-30', {
                    interval: 'week',
                    dateRange: { date_from: '2024-04-30', date_to: '2024-05-02' },
                })
            ).toEqual('30 Apr - 2 May 2024')
        })

        it('handles week boundaries within the date range', () => {
            expect(
                getFormattedDate('2024-04-30', {
                    interval: 'week',
                    dateRange: { date_from: '2024-04-01', date_to: '2024-05-29' },
                })
            ).toEqual('28 Apr - 4 May 2024')
        })

        it('handles timezone-specific week boundaries', () => {
            const timestamp = '2024-04-28T00:00:00-07:00' // PDT
            const dateRange = { date_from: '2024-04-28T00:00:00-07:00', date_to: '2024-05-04T23:59:59-07:00' }
            expect(
                getFormattedDate(timestamp, { interval: 'week', dateRange, timezone: 'America/Los_Angeles' })
            ).toEqual('28 Apr - 4 May 2024')
        })
    })

    describe('with timezone handling', () => {
        it('respects the provided timezone', () => {
            // Test that the same timestamp displays differently in different timezones
            const timestamp = '2024-04-28T23:30:00Z'
            expect(getFormattedDate(timestamp, { timezone: 'UTC' })).toEqual('28 Apr 2024')
            expect(getFormattedDate(timestamp, { timezone: 'America/New_York' })).toEqual('28 Apr 2024')
            expect(getFormattedDate(timestamp, { timezone: 'Asia/Tokyo' })).toEqual('29 Apr 2024')
        })

        // Regression: date-only strings from the trends backend (e.g. "2024-05-01") must
        // format to the same day regardless of the project timezone. The previous
        // implementation used dayjs.tz(string, tz) which goes through new Date() and could
        // shift the date by a day, leaving the tooltip header out of sync with the x-axis.
        it.each(['UTC', 'America/Los_Angeles', 'Asia/Tokyo'])(
            'preserves wall-clock date for date-only daily input in timezone %s',
            (timezone) => {
                expect(getFormattedDate('2024-05-01', { interval: 'day', timezone })).toEqual('1\u00A0May\u00A02024')
            }
        )

        it('preserves wall-clock date across a US DST boundary', () => {
            // Spring-forward day in the US — make sure date-only input still maps cleanly.
            expect(getFormattedDate('2024-03-10', { interval: 'day', timezone: 'America/Los_Angeles' })).toEqual(
                '10\u00A0Mar\u00A02024'
            )
        })

        it('returns the correct week range with provided timezone', () => {
            // Test that the week range is correct in a specific timezone
            const timestamp = '2025-06-15T23:59:59-07:00' // PDT
            expect(
                getFormattedDate(timestamp, {
                    timezone: 'America/Los_Angeles',
                    interval: 'week',
                    dateRange: {
                        date_from: '2025-06-11T00:00:00.000000-07:00',
                        date_to: '2025-06-18T23:59:59.999999-07:00',
                    },
                })
            ).toEqual('15-18 Jun 2025')
        })
    })

    describe('with invalid inputs', () => {
        it('returns the raw input for an unparseable date string', () => {
            expect(getFormattedDate('invalid-date')).toEqual('invalid-date')
        })

        it('expects undefined string if no inputs', () => {
            expect(getFormattedDate()).toEqual('undefined')
        })
    })
})

describe('getFormattedCompareLabel', () => {
    const previousDatum = (date: string): Parameters<typeof getFormattedCompareLabel>[0] => ({
        compare_label: CompareLabelType.Previous,
        date,
    })

    it.each([
        [
            'daily comparison across a month boundary',
            '2024-05-31',
            {
                interval: 'day' as const,
                compareDateRange: { date_from: '2024-05-31T00:00:00Z', date_to: '2024-05-31T23:59:59Z' },
            },
            'Previous (31 May 2024)',
        ],
        [
            'weekly comparison with Monday week start across a year boundary',
            '2024-12-23',
            {
                interval: 'week' as const,
                timezone: 'UTC',
                weekStartDay: 1,
                compareDateRange: { date_from: '2024-12-23T00:00:00Z', date_to: '2024-12-29T23:59:59Z' },
            },
            'Previous (23-29 Dec 2024)',
        ],
        [
            'monthly comparison across a year boundary',
            '2024-12-01',
            {
                interval: 'month' as const,
                compareDateRange: { date_from: '2024-12-01T00:00:00Z', date_to: '2024-12-31T23:59:59Z' },
            },
            'Previous (December 2024)',
        ],
        [
            'daily comparison on a US DST boundary in the project timezone',
            '2024-03-10',
            {
                interval: 'day' as const,
                timezone: 'America/Los_Angeles',
                compareDateRange: {
                    date_from: '2024-03-10T00:00:00-08:00',
                    date_to: '2024-03-10T23:59:59-07:00',
                },
            },
            'Previous (10 Mar 2024)',
        ],
        [
            'partial weekly comparison constrained to the resolved compare range',
            '2025-06-08',
            {
                interval: 'week' as const,
                timezone: 'America/Los_Angeles',
                weekStartDay: 0,
                compareDateRange: {
                    date_from: '2025-06-08T00:00:00-07:00',
                    date_to: '2025-06-11T23:59:59-07:00',
                },
            },
            'Previous (8-11 Jun 2025)',
        ],
    ])('adds the previous bucket date for %s', (_, date, options, expected) => {
        expect(getFormattedCompareLabel(previousDatum(date), options)).toEqual(expected)
    })

    it('does not duplicate the current bucket date in the current comparison label', () => {
        expect(
            getFormattedCompareLabel(
                { compare_label: CompareLabelType.Current, date: '2025-01-01' },
                { interval: 'day' }
            )
        ).toEqual('Current')
    })

    it('keeps custom comparison label formatting for callers that provide one', () => {
        expect(
            getFormattedCompareLabel(
                { compare_label: CompareLabelType.Previous, date: '2025-01-01', date_label: 'Jan 1' },
                {
                    interval: 'day',
                    formatCompareLabel: (label, dateLabel) => `${label}:${dateLabel}`,
                }
            )
        ).toEqual('previous:Jan 1')
    })

    it('adds the previous bucket date alongside breakdown labels', () => {
        const html = renderToStaticMarkup(
            createElement(
                Fragment,
                null,
                getDatumTitle(
                    {
                        id: 0,
                        dataIndex: 0,
                        datasetIndex: 0,
                        order: 0,
                        breakdown_value: 'Chrome',
                        compare_label: CompareLabelType.Previous,
                        date: '2025-06-05',
                        count: 12,
                    },
                    null,
                    { interval: 'day', timezone: 'UTC' }
                )
            )
        )

        expect(html).toContain('Chrome')
        expect(html).toContain('Previous (5 Jun 2025)')
    })
})
