import type { Layout, ResponsiveLayouts } from 'react-grid-layout'

import type { DashboardTile, QueryBasedInsightModel } from '~/types'

export type DashboardTextTileKind = 'text' | 'section'

export const DEFAULT_DASHBOARD_SECTION_HEADER_TITLE = 'New section'

const DASHBOARD_GRID_COLUMNS = 12
const DASHBOARD_SECTION_HEADER_HEIGHT = 1
const DASHBOARD_SECTION_HEADER_REGEX = /^#\s+([^\n]+)$/

export function getDashboardSectionHeaderMarkdown(title: string): string {
    return `# ${title.trim() || DEFAULT_DASHBOARD_SECTION_HEADER_TITLE}`
}

export function getDashboardSectionHeaderTitle(body: string | null | undefined): string | null {
    const match = body?.trim().match(DASHBOARD_SECTION_HEADER_REGEX)
    return match ? match[1].trim() : null
}

export function isDashboardSectionHeaderTextTile(
    tile: Pick<DashboardTile<QueryBasedInsightModel>, 'text' | 'transparent_background'> | null | undefined
): boolean {
    return tile?.transparent_background === true && getDashboardSectionHeaderTitle(tile.text?.body) !== null
}

export function getDashboardTextTileKind(
    tile: Pick<DashboardTile<QueryBasedInsightModel>, 'text' | 'transparent_background'> | null | undefined,
    fallback: DashboardTextTileKind = 'text'
): DashboardTextTileKind {
    return isDashboardSectionHeaderTextTile(tile) ? 'section' : fallback
}

function getNextDashboardLayoutY(layouts: Layout | undefined): number {
    return (layouts ?? []).reduce((maxY, layout) => Math.max(maxY, (layout.y ?? 0) + (layout.h ?? 0)), 0)
}

export function getDashboardSectionHeaderLayouts(
    layouts: ResponsiveLayouts | null | undefined
): DashboardTile<QueryBasedInsightModel>['layouts'] {
    return {
        sm: {
            x: 0,
            y: getNextDashboardLayoutY(layouts?.sm),
            w: DASHBOARD_GRID_COLUMNS,
            h: DASHBOARD_SECTION_HEADER_HEIGHT,
        },
        xs: {
            x: 0,
            y: getNextDashboardLayoutY(layouts?.xs ?? layouts?.sm),
            w: 1,
            h: DASHBOARD_SECTION_HEADER_HEIGHT,
        },
    }
}
