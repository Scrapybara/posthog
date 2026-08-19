export interface DashboardSectionHeader {
    title: string
    description: string
}

const SECTION_HEADER_PREFIX = '<!--posthog-dashboard-section-header:'
const SECTION_HEADER_SUFFIX = '-->'

function escapeMarkdown(value: string): string {
    return value.replace(/([\\`*_[\]<>#])/g, '\\$1')
}

export function serializeDashboardSectionHeader({ title, description }: DashboardSectionHeader): string {
    const normalizedTitle = title.trim()
    const normalizedDescription = description.trim()
    const metadata = encodeURIComponent(JSON.stringify({ title: normalizedTitle, description: normalizedDescription }))
    const fallback = [`## ${escapeMarkdown(normalizedTitle)}`]

    if (normalizedDescription) {
        fallback.push('', escapeMarkdown(normalizedDescription))
    }

    return `${SECTION_HEADER_PREFIX}${metadata}${SECTION_HEADER_SUFFIX}\n${fallback.join('\n')}`
}

export function parseDashboardSectionHeader(body: string): DashboardSectionHeader | null {
    if (!body.startsWith(SECTION_HEADER_PREFIX)) {
        return null
    }

    const metadataEnd = body.indexOf(SECTION_HEADER_SUFFIX, SECTION_HEADER_PREFIX.length)
    if (metadataEnd === -1) {
        return null
    }

    try {
        const metadata = JSON.parse(
            decodeURIComponent(body.slice(SECTION_HEADER_PREFIX.length, metadataEnd))
        ) as Partial<DashboardSectionHeader>

        if (typeof metadata.title !== 'string' || typeof metadata.description !== 'string' || !metadata.title.trim()) {
            return null
        }

        return { title: metadata.title, description: metadata.description }
    } catch {
        return null
    }
}

export function isDashboardSectionHeader(body: string | undefined): boolean {
    return body ? parseDashboardSectionHeader(body) !== null : false
}
