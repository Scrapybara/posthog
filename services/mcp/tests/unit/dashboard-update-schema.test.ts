import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import type { Schemas } from '@/api/generated'
import { DashboardsPartialUpdateBody } from '@/generated/dashboards/api'
import { GENERATED_TOOLS } from '@/tools/generated/dashboards'

const metadataOnlyWidgetPatch: Schemas._DashboardPatchExistingWidgetOpenApi = {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Renamed widget',
}
void metadataOnlyWidgetPatch

const metadataOnlyWidgetPatchWithType: Schemas._DashboardPatchExistingWidgetOpenApi = {
    id: '00000000-0000-4000-8000-000000000002',
    // @ts-expect-error metadata-only widget PATCHes must not accept widget_type.
    widget_type: 'live_activity',
}
void metadataOnlyWidgetPatchWithType

const metadataOnlyWidgetPatchWithConfig: Schemas._DashboardPatchExistingWidgetOpenApi = {
    id: '00000000-0000-4000-8000-000000000002',
    // @ts-expect-error metadata-only widget PATCHes must not accept config.
    config: { limit: 5 },
}
void metadataOnlyWidgetPatchWithConfig

function getSchemaShape(schema: z.ZodTypeAny): Record<string, z.ZodTypeAny> {
    if ('shape' in schema && schema.shape && typeof schema.shape === 'object') {
        return schema.shape as Record<string, z.ZodTypeAny>
    }
    const inner = (schema._def as { schema?: z.ZodTypeAny }).schema
    if (inner) {
        return getSchemaShape(inner)
    }
    throw new Error(`Expected object schema, got ${schema.constructor.name}`)
}

describe('dashboard-update schema', () => {
    const tool = GENERATED_TOOLS['dashboard-update']!()
    const batchAddTool = GENERATED_TOOLS['dashboard-widgets-batch-add']!()

    it('includes every OpenAPI PATCH body field from DashboardsPartialUpdateBody', () => {
        const toolShape = getSchemaShape(tool.schema)
        const openapiBodyKeys = Object.keys(DashboardsPartialUpdateBody.shape)

        for (const param of openapiBodyKeys) {
            expect(toolShape[param], `dashboard-update schema missing OpenAPI field: ${param}`).not.toBeUndefined()
        }
    })

    it('accepts optional dashboard PATCH write params', () => {
        const result = tool.schema.safeParse({
            id: 1,
            breakdown_colors: { series_a: '#ff0000' },
            data_color_theme_id: 2,
            quick_filter_ids: ['00000000-0000-4000-8000-000000000001'],
            use_template: '',
            use_dashboard: null,
            delete_insights: false,
            tiles: [{ id: 1, widget: { id: '00000000-0000-4000-8000-000000000002', name: 'Renamed widget' } }],
        })

        expect(result.success).toBe(true)
    })

    it('accepts metadata-only widget PATCHes without widget_type', () => {
        const result = tool.schema.safeParse({
            id: 1,
            tiles: [
                {
                    id: 2,
                    widget: {
                        id: '00000000-0000-4000-8000-000000000002',
                        name: 'Renamed widget',
                        description: 'Updated description',
                    },
                },
            ],
        })

        expect(result.success).toBe(true)
        expect(result.data.tiles?.[0]?.widget).toEqual({
            id: '00000000-0000-4000-8000-000000000002',
            name: 'Renamed widget',
            description: 'Updated description',
        })
    })

    it('preserves live activity config fields when widget_type is provided', () => {
        const result = tool.schema.safeParse({
            id: 1,
            tiles: [
                {
                    id: 2,
                    widget: {
                        widget_type: 'live_activity',
                        config: { filterTestAccounts: false, refreshIntervalSeconds: 30 },
                    },
                },
            ],
        })

        expect(result.success).toBe(true)
        expect(result.data.tiles?.[0]?.widget?.config).toEqual({
            filterTestAccounts: false,
            limit: 5,
            refreshIntervalSeconds: 30,
        })
    })

    it('rejects widget config PATCHes without widget_type', () => {
        const result = tool.schema.safeParse({
            id: 1,
            tiles: [
                {
                    id: 2,
                    widget: {
                        id: '00000000-0000-4000-8000-000000000002',
                        config: { limit: 10 },
                    },
                },
            ],
        })

        expect(result.success).toBe(false)
    })

    it('rejects unknown widget types before the metadata-only fallback', () => {
        const result = tool.schema.safeParse({
            id: 1,
            tiles: [
                {
                    id: 2,
                    widget: {
                        id: '00000000-0000-4000-8000-000000000002',
                        widget_type: 'unknown_widget',
                        config: { limit: 10 },
                    },
                },
            ],
        })

        expect(result.success).toBe(false)
    })

    it('rejects invalid live activity config before the metadata-only fallback', () => {
        const result = tool.schema.safeParse({
            id: 1,
            tiles: [
                {
                    id: 2,
                    widget: {
                        id: '00000000-0000-4000-8000-000000000002',
                        widget_type: 'live_activity',
                        config: { limit: 11, refreshIntervalSeconds: 30 },
                    },
                },
            ],
        })

        expect(result.success).toBe(false)
    })

    it('preserves live activity config fields for batch-add widgets', () => {
        const result = batchAddTool.schema.safeParse({
            id: 1,
            widgets: [
                {
                    widget_type: 'live_activity',
                    config: { filterTestAccounts: false, refreshIntervalSeconds: 30 },
                },
            ],
        })

        expect(result.success).toBe(true)
        expect(result.data.widgets?.[0]?.config).toEqual({
            filterTestAccounts: false,
            limit: 5,
            refreshIntervalSeconds: 30,
        })
    })
})
