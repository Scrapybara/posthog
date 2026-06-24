import { JSONContent } from '@tiptap/core'

import { markdownToTextCardDoc, textCardDocToMarkdown } from 'lib/components/Cards/TextCard/textCardMarkdown'

import { DashboardTile, QueryBasedInsightModel } from '~/types'

/**
 * A "Section header" is not a distinct database entity — it is an ordinary transparent text tile
 * whose markdown body is a single heading, an optional short description paragraph, and a trailing
 * horizontal rule that renders as a full-width divider under the header. Composing and parsing both
 * go through the shared TextCard markdown pipeline so escaping and round-tripping stay consistent
 * with the regular text card editor. Title and description are treated as inline markdown source:
 * inline emphasis and links are preserved verbatim across edits, and block-level markdown in the
 * description (lists, headings, blockquotes, thematic breaks) is rejected at validation time rather
 * than silently corrupted, because a section header is a single heading plus one paragraph.
 */

export const SECTION_HEADER_HEADING_LEVEL = 2
export const SECTION_HEADER_MAX_TITLE_LENGTH = 200
export const SECTION_HEADER_MAX_DESCRIPTION_LENGTH = 300

export interface SectionHeaderFields {
    title: string
    description: string
}

/** Collapse all whitespace (including newlines) to single spaces so a section stays one heading + one paragraph. */
function normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
}

/**
 * Serialize a block node's inline children back to markdown source, preserving inline marks (emphasis,
 * links, code). The children are wrapped in a paragraph and round-tripped through the TextCard markdown
 * serializer so the produced source re-parses to the same content — i.e. `*emphasis*` and `[a](b)` survive
 * an edit instead of being flattened to plain text.
 */
function nodeInlineToMarkdown(node: JSONContent | undefined): string {
    if (!node || !node.content) {
        return ''
    }
    return textCardDocToMarkdown({ type: 'doc', content: [{ type: 'paragraph', content: node.content }] }).trim()
}

/**
 * Whether a description can be stored as the section header's single paragraph. It can iff it parses to
 * exactly one paragraph — i.e. it contains only inline content. Block-level markdown such as a list
 * (`- item`), heading (`# x`), blockquote (`> x`), or thematic break (`---`) parses to a non-paragraph
 * block and would either break the section shape or be corrupted, so those are rejected. Inputs that are
 * not actually block syntax (e.g. `#growth`, which Markdown does not parse as a heading) stay valid.
 */
export function isSectionHeaderDescriptionInline(description: string): boolean {
    const normalized = normalizeWhitespace(description)
    if (!normalized) {
        return true
    }
    const nodes = (markdownToTextCardDoc(normalized).content || []).filter((node) => node.type !== undefined)
    return nodes.length === 1 && nodes[0].type === 'paragraph'
}

/**
 * Build the markdown body for a section header from its title and optional description. Inputs are
 * normalized to a single line so the body stays a heading plus one paragraph, and a trailing `---` divider
 * is appended so the rendered tile shows a full-width rule under the header. Title and description are
 * emitted as inline markdown source; callers should validate the description with
 * {@link isSectionHeaderDescriptionInline} first so it cannot turn into a block and break the shape.
 */
export function composeSectionHeaderBody({ title, description }: SectionHeaderFields): string {
    const normalizedTitle = normalizeWhitespace(title)
    const normalizedDescription = normalizeWhitespace(description)

    const headingPrefix = '#'.repeat(SECTION_HEADER_HEADING_LEVEL)
    const blocks = [`${headingPrefix} ${normalizedTitle}`.trimEnd()]
    if (normalizedDescription) {
        blocks.push(normalizedDescription)
    }
    blocks.push('---')
    return blocks.join('\n\n')
}

/**
 * Parse a markdown body back into section header fields, or return null when the body is not the exact
 * signature emitted by {@link composeSectionHeaderBody}: a level-2 heading, an optional single description
 * paragraph, and a required trailing horizontal rule — nothing else. Requiring the canonical signature
 * keeps ordinary transparent text cards (other heading levels, no divider, richer content) out of the
 * compact section editor. Inline marks are serialized back to markdown source so edits are lossless.
 */
export function parseSectionHeaderBody(body: string | null | undefined): SectionHeaderFields | null {
    if (!body || !body.trim()) {
        return null
    }

    const doc = markdownToTextCardDoc(body)
    const nodes = (doc.content || []).filter((node) => node.type !== undefined)

    // A canonical section header always ends with the divider (a single trailing horizontal rule).
    if (nodes.length === 0 || nodes[nodes.length - 1].type !== 'horizontalRule') {
        return null
    }
    const core = nodes.slice(0, -1)
    if (core.length < 1 || core.length > 2) {
        return null
    }

    const [headingNode, descriptionNode] = core
    if (headingNode.type !== 'heading' || headingNode.attrs?.level !== SECTION_HEADER_HEADING_LEVEL) {
        return null
    }
    if (descriptionNode && descriptionNode.type !== 'paragraph') {
        return null
    }

    return {
        title: nodeInlineToMarkdown(headingNode),
        description: nodeInlineToMarkdown(descriptionNode),
    }
}

/**
 * Whether a dashboard tile should be treated as a section header: a transparent text tile whose body
 * round-trips to the canonical section header signature. Used to route editing to the compact form and to
 * label the tile; the visual treatment itself comes entirely from the composed markdown.
 */
export function isSectionHeaderTile(
    tile: Pick<DashboardTile<QueryBasedInsightModel>, 'text' | 'transparent_background'> | null | undefined
): boolean {
    if (!tile?.text?.body || tile.transparent_background !== true) {
        return false
    }
    return parseSectionHeaderBody(tile.text.body) !== null
}
