import posthog from 'posthog-js'

import { ApiError } from 'lib/api-error'

import {
    DASHBOARD_WIDGET_CATALOG,
    DASHBOARD_WIDGET_PREVIEWS,
    getDashboardWidgetCatalogEntry,
    type DashboardWidgetCatalogEntry,
} from '../widget_types/catalog'
import {
    getDashboardWidgetDefinition,
    parseDashboardWidgetConfigApiError,
    resetDashboardWidgetRegistryReportingForTests,
} from './registry'

jest.mock('posthog-js', () => ({
    __esModule: true,
    default: {
        captureException: jest.fn(),
    },
}))

describe('dashboard widget registry', () => {
    beforeEach(() => {
        jest.mocked(posthog.captureException).mockClear()
        resetDashboardWidgetRegistryReportingForTests()
    })

    it.each(Object.keys(DASHBOARD_WIDGET_CATALOG))('registers catalog widget %s', (widgetType) => {
        const definition = getDashboardWidgetDefinition(widgetType)
        const catalogEntry: DashboardWidgetCatalogEntry =
            DASHBOARD_WIDGET_CATALOG[widgetType as keyof typeof DASHBOARD_WIDGET_CATALOG]

        expect(definition?.Component).toBeTruthy()
        expect(definition?.EditModal).toBeTruthy()
        expect(definition?.productAccess).toBe(catalogEntry.productAccess)
        if (catalogEntry.tileFilters) {
            expect(definition?.TileFilters).toBeTruthy()
            expect(catalogEntry.tileFilters.allowedPropertyNames.length).toBeGreaterThan(0)
        }
        expect(definition?.parseConfigApiError).toBeTruthy()
        expect(posthog.captureException).not.toHaveBeenCalled()
    })

    it('registers every catalog preview', () => {
        expect(Object.keys(DASHBOARD_WIDGET_PREVIEWS).sort()).toEqual(Object.keys(DASHBOARD_WIDGET_CATALOG).sort())
        expect(DASHBOARD_WIDGET_PREVIEWS.live_activity()).toBeTruthy()
    })

    it('documents live activity catalog defaults and shared placeholder copy', () => {
        const entry = getDashboardWidgetCatalogEntry('live_activity')

        expect(entry.groupId).toBe('activity')
        expect(entry.defaultLayout).toEqual({ w: 4, h: 4, minW: 3, minH: 3 })
        expect(entry.headerMeta.showDateRange).toBe(false)
        expect(entry.defaultConfig).toEqual({
            limit: 5,
            refreshIntervalSeconds: 15,
        })
        expect(entry.sharedPlaceholder).toEqual({
            title: 'Live activity',
            message: 'Log in to PostHog to see live activity from this dashboard.',
        })
    })

    it('delegates config api error parsing to the widget registry entry', () => {
        const error = new ApiError('limit must be an integer between 1 and 25.', 400, undefined, {
            config: 'limit must be an integer between 1 and 25.',
        })
        const invalidConfig = {
            limit: 30,
            orderBy: 'occurrences',
            orderDirection: 'DESC',
            status: 'active',
            dateRange: { date_from: '-7d' },
        }

        expect(parseDashboardWidgetConfigApiError('error_tracking_list', error, invalidConfig)).toEqual({
            limit: 'Too big: expected number to be <=25',
        })
        expect(parseDashboardWidgetConfigApiError('unknown_widget_type', error, invalidConfig)).toBeNull()
    })

    it('reports unknown widget types to PostHog once per canonical type', () => {
        expect(getDashboardWidgetDefinition('unknown_widget_type')).toBeUndefined()
        expect(getDashboardWidgetDefinition('unknown_widget_type')).toBeUndefined()

        expect(posthog.captureException).toHaveBeenCalledTimes(1)
        expect(posthog.captureException).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Dashboard widget type has no frontend registry implementation',
            }),
            expect.objectContaining({
                feature: 'dashboard_widget',
                widget_type: 'unknown_widget_type',
                canonical_widget_type: 'unknown_widget_type',
                has_catalog_entry: false,
            })
        )
    })

    it('includes tile context when provided', () => {
        getDashboardWidgetDefinition('unknown_widget_type', { tileId: 42, dashboardId: 7 })

        expect(posthog.captureException).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({
                tile_id: 42,
                dashboard_id: 7,
            })
        )
    })
})
