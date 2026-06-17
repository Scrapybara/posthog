import { DashboardTile, QueryBasedInsightModel, TileLayout } from '~/types'

export const SECTION_HEADER_DESKTOP_WIDTH = 12
export const SECTION_HEADER_DESKTOP_HEIGHT = 1
export const SECTION_HEADER_MOBILE_HEIGHT = 2
export const SECTION_HEADER_MAX_TITLE_LENGTH = 120
export const SECTION_HEADER_MAX_DESCRIPTION_LENGTH = 240
const SECTION_HEADER_MARKER = '<!-- posthog-dashboard-section-header -->'

export interface DashboardSectionHeaderContent {
    title: string
    description: string
}

const MARKDOWN_ESCAPE_PATTERN = /([\\`*_{}[\]<>()#+\-.!|])/g
const MARKDOWN_UNESCAPE_PATTERN = /\\([\\`*_{}[\]<>()#+\-.!|])/g

function normalizeSectionHeaderText(value: string): string {
    return value.replace(/\s+/g, ' ').trim()
}

function escapeMarkdownText(value: string): string {
    return normalizeSectionHeaderText(value).replace(MARKDOWN_ESCAPE_PATTERN, '\\$1')
}

function unescapeMarkdownText(value: string): string {
    return normalizeSectionHeaderText(value).replace(MARKDOWN_UNESCAPE_PATTERN, '$1')
}

export function buildDashboardSectionHeaderBody({ title, description }: DashboardSectionHeaderContent): string {
    const escapedTitle = escapeMarkdownText(title)
    const escapedDescription = escapeMarkdownText(description)

    const body = escapedDescription ? `## ${escapedTitle}\n\n${escapedDescription}` : `## ${escapedTitle}`
    return `${SECTION_HEADER_MARKER}\n${body}`
}

export function parseDashboardSectionHeaderBody(body: string | null | undefined): DashboardSectionHeaderContent | null {
    if (!body?.trim()) {
        return null
    }

    const [markerLine, ...contentLines] = body.trim().split(/\r?\n/)
    if (markerLine.trim() !== SECTION_HEADER_MARKER) {
        return null
    }

    const [headingLine, ...descriptionLines] = contentLines.join('\n').trim().split(/\r?\n/)
    const headingMatch = headingLine.match(/^##\s+(.+)$/)
    if (!headingMatch) {
        return null
    }

    const description = descriptionLines.join('\n').trim()

    return {
        title: unescapeMarkdownText(headingMatch[1]),
        description: description ? unescapeMarkdownText(description) : '',
    }
}

export function isDashboardSectionHeaderTile(
    tile: Pick<DashboardTile<QueryBasedInsightModel>, 'text' | 'transparent_background'> | null | undefined
): boolean {
    return (
        !!tile?.text?.body && tile.transparent_background === true && !!parseDashboardSectionHeaderBody(tile.text.body)
    )
}

export function defaultSectionHeaderLayoutAtBottom(smLayout: ReadonlyArray<{ y?: number; h?: number }> | undefined): {
    sm: TileLayout
} {
    let maxBottom = 0
    for (const layout of smLayout ?? []) {
        maxBottom = Math.max(maxBottom, (layout.y ?? 0) + (layout.h ?? 0))
    }

    return {
        sm: {
            x: 0,
            y: maxBottom,
            w: SECTION_HEADER_DESKTOP_WIDTH,
            h: SECTION_HEADER_DESKTOP_HEIGHT,
        },
    }
}
