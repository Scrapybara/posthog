import { JSONContent } from '@tiptap/core'

import { markdownToTextCardDoc } from 'lib/components/Cards/TextCard/textCardMarkdown'

import { DashboardTile, QueryBasedInsightModel } from '~/types'

/**
 * A "Section header" is not a distinct database entity — it is an ordinary transparent text tile
 * whose markdown body is a single heading, an optional short description paragraph, and a trailing
 * horizontal rule that renders as a full-width divider under the header. Composing and parsing both
 * go through the shared TextCard markdown pipeline so escaping and round-tripping stay consistent
 * with the regular text card editor.
 */

export const SECTION_HEADER_HEADING_LEVEL = 2
export const SECTION_HEADER_MAX_TITLE_LENGTH = 200
export const SECTION_HEADER_MAX_DESCRIPTION_LENGTH = 300

export interface SectionHeaderFields {
    title: string
    description: string
}

/** Concatenate the plain text of a tiptap node, dropping inline marks. */
function nodeToPlainText(node: JSONContent | undefined): string {
    if (!node) {
        return ''
    }
    if (typeof node.text === 'string') {
        return node.text
    }
    return (node.content || []).map(nodeToPlainText).join('')
}

/** Collapse all whitespace (including newlines) to single spaces so a section stays one heading + one paragraph. */
function normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
}

/**
 * Strip a leading block marker (list bullet, ordered-list number, blockquote `>`, or heading `#`) from the
 * description so it stays a single paragraph instead of being parsed as its own block, which would break the
 * section header shape. Common punctuation and inline text are left untouched.
 */
function neutralizeLeadingBlockMarker(text: string): string {
    return text.replace(/^(?:[-+*]\s+|\d+[.)]\s+|[#>]+\s*)+/, '')
}

/**
 * Build the markdown body for a section header from its title and optional description. Inputs are
 * normalized to a single line so the body stays a heading plus one paragraph, and a leading block marker
 * on the description is neutralized so it cannot turn into a list/quote. A trailing `---` divider is
 * appended so the rendered tile shows a full-width rule under the header. Normal text and punctuation are
 * preserved verbatim; inline markdown (e.g. `*emphasis*`) is rendered as markdown, matching text cards.
 */
export function composeSectionHeaderBody({ title, description }: SectionHeaderFields): string {
    const normalizedTitle = normalizeWhitespace(title)
    const normalizedDescription = neutralizeLeadingBlockMarker(normalizeWhitespace(description))

    const headingPrefix = '#'.repeat(SECTION_HEADER_HEADING_LEVEL)
    const blocks = [`${headingPrefix} ${normalizedTitle}`.trimEnd()]
    if (normalizedDescription) {
        blocks.push(normalizedDescription)
    }
    blocks.push('---')
    return blocks.join('\n\n')
}

/**
 * Parse a markdown body back into section header fields, or return null when the body is not
 * shaped like a section header. A section header body is a leading heading (level 1–3), an optional
 * single description paragraph, and an optional trailing horizontal rule — nothing else.
 */
export function parseSectionHeaderBody(body: string | null | undefined): SectionHeaderFields | null {
    if (!body || !body.trim()) {
        return null
    }

    const doc = markdownToTextCardDoc(body)
    const content = (doc.content || []).filter((node) => node.type !== undefined)

    // Drop a single trailing horizontal rule (the section divider) before validating the shape.
    const withoutTrailingDivider =
        content.length > 0 && content[content.length - 1].type === 'horizontalRule' ? content.slice(0, -1) : content

    if (withoutTrailingDivider.length < 1 || withoutTrailingDivider.length > 2) {
        return null
    }

    const [headingNode, descriptionNode] = withoutTrailingDivider
    if (headingNode.type !== 'heading') {
        return null
    }
    if (descriptionNode && descriptionNode.type !== 'paragraph') {
        return null
    }

    return {
        title: nodeToPlainText(headingNode),
        description: nodeToPlainText(descriptionNode),
    }
}

function hasSectionHeaderDivider(body: string): boolean {
    const doc = markdownToTextCardDoc(body)
    const content = (doc.content || []).filter((node) => node.type !== undefined)
    return content.length > 0 && content[content.length - 1].type === 'horizontalRule'
}

/**
 * Whether a dashboard tile should be treated as a section header: a transparent text tile whose body
 * round-trips to the section header shape. Used to route editing to the compact form and to label the
 * tile; the visual treatment itself comes entirely from the composed markdown.
 */
export function isSectionHeaderTile(
    tile: Pick<DashboardTile<QueryBasedInsightModel>, 'text' | 'transparent_background'> | null | undefined
): boolean {
    if (!tile?.text?.body || tile.transparent_background !== true) {
        return false
    }
    return hasSectionHeaderDivider(tile.text.body) && parseSectionHeaderBody(tile.text.body) !== null
}
