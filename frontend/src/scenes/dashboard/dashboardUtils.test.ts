import { buildDashboardSectionHeaderBody } from 'lib/components/Cards/TextCard/textCardSectionHeader'
import { dayjs } from 'lib/dayjs'

import { DashboardPlacement, DashboardTile, QueryBasedInsightModel } from '~/types'

import {
    dashboardToSaveableTemplate,
    getDashboardTileDisplayName,
    isWidgetTileVisibleOnPlacement,
    parseURLFilters,
    parseURLVariables,
    SEARCH_PARAM_FILTERS_KEY,
    SEARCH_PARAM_QUERY_VARIABLES_KEY,
    shouldSharedDashboardAutoForceForStaleTime,
} from './dashboardUtils'

describe('getDashboardTileDisplayName', () => {
    it('uses widget header title when no custom name is set', () => {
        const tile: DashboardTile<QueryBasedInsightModel> = {
            id: 1,
            widget: { id: '1', widget_type: 'error_tracking_list', config: {} },
            layouts: {},
            color: null,
        }

        expect(getDashboardTileDisplayName(tile)).toBe('Top issues')
    })

    it('uses custom widget name when set', () => {
        const tile: DashboardTile<QueryBasedInsightModel> = {
            id: 1,
            widget: { id: '1', widget_type: 'error_tracking_list', config: {}, name: 'Critical errors' },
            layouts: {},
            color: null,
        }

        expect(getDashboardTileDisplayName(tile)).toBe('Critical errors')
    })

    it('names section header text tiles distinctly', () => {
        const tile: DashboardTile<QueryBasedInsightModel> = {
            id: 1,
            text: {
                body: buildDashboardSectionHeaderBody({ title: 'Activation', description: '' }),
                last_modified_at: '2024-01-01T00:00:00Z',
            },
            transparent_background: true,
            layouts: {},
            color: null,
        }

        expect(getDashboardTileDisplayName(tile)).toBe('Section header')
    })
})

describe('dashboardToSaveableTemplate', () => {
    it('preserves section header text tile fields for templates', () => {
        const body = buildDashboardSectionHeaderBody({ title: 'Activation', description: 'Key funnel steps' })

        expect(
            dashboardToSaveableTemplate({
                id: 1,
                name: 'Dashboard',
                description: '',
                filters: {},
                tags: [],
                tiles: [
                    {
                        id: 1,
                        text: { body },
                        transparent_background: true,
                        layouts: { sm: { x: 0, y: 0, w: 12, h: 1 } },
                        color: null,
                    } as DashboardTile<QueryBasedInsightModel>,
                ],
            } as any)
        )?.toMatchObject({
            tiles: [
                {
                    type: 'TEXT',
                    body,
                    transparent_background: true,
                    layouts: { sm: { x: 0, y: 0, w: 12, h: 1 } },
                },
            ],
        })
    })
})

describe('isWidgetTileVisibleOnPlacement', () => {
    it.each([
        [DashboardPlacement.Dashboard, true],
        [DashboardPlacement.Public, true],
        [DashboardPlacement.Export, false],
    ])('placement=%s → %s', (placement, expected) => {
        expect(isWidgetTileVisibleOnPlacement(placement)).toBe(expected)
    })
})

describe('parseURLVariables', () => {
    it.each([
        ['a JSON string value', '{"card_name":"Polukranos, Unchained"}', { card_name: 'Polukranos, Unchained' }],
        [
            'an already-parsed object (kea-router auto-parse)',
            { card_name: 'Polukranos, Unchained' },
            { card_name: 'Polukranos, Unchained' },
        ],
    ])('parses %s from search params', (_, input, expected) => {
        const result = parseURLVariables({ [SEARCH_PARAM_QUERY_VARIABLES_KEY]: input })
        expect(result).toEqual(expected)
    })

    it('returns empty object when key is missing', () => {
        expect(parseURLVariables({})).toEqual({})
    })

    it('returns empty object for invalid JSON string', () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
        const searchParams = {
            [SEARCH_PARAM_QUERY_VARIABLES_KEY]: 'not-json',
        }
        expect(parseURLVariables(searchParams)).toEqual({})
        consoleSpy.mockRestore()
    })
})

describe('parseURLFilters', () => {
    it.each([
        ['a JSON string value', '{"date_from":"-7d"}', { date_from: '-7d' }],
        [
            'an already-parsed object (kea-router auto-parse)',
            { date_from: '-7d', date_to: 'now' },
            { date_from: '-7d', date_to: 'now' },
        ],
    ])('parses %s from search params', (_, input, expected) => {
        const result = parseURLFilters({ [SEARCH_PARAM_FILTERS_KEY]: input })
        expect(result).toEqual(expected)
    })

    it('returns empty object when key is missing', () => {
        expect(parseURLFilters({})).toEqual({})
    })

    it('returns empty object for invalid JSON string', () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
        const searchParams = {
            [SEARCH_PARAM_FILTERS_KEY]: 'not-json',
        }
        expect(parseURLFilters(searchParams)).toEqual({})
        consoleSpy.mockRestore()
    })
})

describe('shouldSharedDashboardAutoForceForStaleTime', () => {
    it.each<[string, dayjs.Dayjs | null, boolean]>([
        ['last refresh is null', null, false],
        ['last refresh is an invalid Dayjs', dayjs(new Date(Number.NaN)), false],
        ['stalest tile is newer than the auto-force threshold', dayjs().subtract(29, 'minute'), false],
        ['stalest tile is older than the auto-force threshold', dayjs().subtract(31, 'minute'), true],
    ])('when %s, returns expected result', (_, input, expected) => {
        expect(shouldSharedDashboardAutoForceForStaleTime(input)).toBe(expected)
    })

    describe('with fixed clock', () => {
        beforeEach(() => {
            jest.useFakeTimers()
            jest.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))
        })

        afterEach(() => {
            jest.useRealTimers()
        })

        it.each<[string, string, boolean]>([
            ['at exactly the threshold age (30 minutes)', '2026-06-15T11:30:00.000Z', true],
            ['just under the threshold', '2026-06-15T11:31:00.000Z', false],
        ])('when %s, returns expected result', (_, isoTime, expected) => {
            expect(shouldSharedDashboardAutoForceForStaleTime(dayjs(isoTime))).toBe(expected)
        })
    })
})
