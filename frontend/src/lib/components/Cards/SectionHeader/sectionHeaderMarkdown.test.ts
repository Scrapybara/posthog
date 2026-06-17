import {
    composeSectionHeaderBody,
    isSectionHeaderDescriptionInline,
    isSectionHeaderTile,
    parseSectionHeaderBody,
} from './sectionHeaderMarkdown'

describe('sectionHeaderMarkdown', () => {
    describe('composeSectionHeaderBody', () => {
        it('builds a heading, description, and trailing divider', () => {
            const body = composeSectionHeaderBody({
                title: 'Acquisition',
                description: 'How new users discover and sign up for the product',
            })
            expect(body).toContain('## Acquisition')
            expect(body).toContain('How new users discover and sign up for the product')
            expect(body.endsWith('---')).toBe(true)
        })

        it('omits the description block when no description is given', () => {
            const body = composeSectionHeaderBody({ title: 'Conversion', description: '' })
            expect(body).toBe('## Conversion\n\n---')
        })

        it('trims surrounding whitespace and collapses newlines into a single line', () => {
            const body = composeSectionHeaderBody({ title: '  Retention  ', description: 'weekly\nand monthly' })
            expect(body).toContain('## Retention')
            expect(body).toContain('weekly and monthly')
            expect(body).not.toContain('  Retention')
        })

        it.each([
            'Acquisition',
            'Revenue & Growth',
            'Active users (weekly)',
            'Conversion: signup -> paid',
            '50% growth target',
            'Week-over-week',
            'C# & .NET',
            'Rate > 50',
            'Roadmap [2026]',
            '#growth',
        ])('preserves normal punctuation verbatim through a round-trip (%s)', (title) => {
            const fields = { title, description: 'supporting copy with (parens), commas & dashes - like this' }
            expect(parseSectionHeaderBody(composeSectionHeaderBody(fields))).toEqual(fields)
        })

        it.each([
            ['emphasis in the title', { title: '*Important*', description: 'desc' }],
            ['a link in the title', { title: '[Docs](https://example.com)', description: 'desc' }],
            ['emphasis in the description', { title: 'Title', description: '*emphasised* copy' }],
            ['a link in the description', { title: 'Title', description: 'see [docs](https://example.com)' }],
        ])('preserves inline markdown across an edit round-trip (%s)', (_label, fields) => {
            // The parsed fields feed straight back into the edit form, so they must re-compose to the same body.
            const parsed = parseSectionHeaderBody(composeSectionHeaderBody(fields))
            expect(parsed).toEqual(fields)
            expect(composeSectionHeaderBody(parsed!)).toBe(composeSectionHeaderBody(fields))
        })
    })

    describe('isSectionHeaderDescriptionInline', () => {
        it.each([
            ['empty', ''],
            ['plain text', 'How users sign up'],
            ['a hash that is not a heading', '#growth'],
            ['inline emphasis', '*important*'],
            ['an inline link', '[docs](https://example.com)'],
            ['punctuation', 'a & b (c) -> d'],
        ])('accepts inline-only descriptions (%s)', (_label, description) => {
            expect(isSectionHeaderDescriptionInline(description)).toBe(true)
        })

        it.each([
            ['a thematic break', '---'],
            ['asterisk thematic break', '***'],
            ['underscore thematic break', '___'],
            ['a heading', '# heading'],
            ['a bullet list', '- item'],
            ['a star list', '* item'],
            ['a plus list', '+ item'],
            ['an ordered list', '1. item'],
            ['a parenthesised ordered list', '2) item'],
            ['a blockquote', '> quote'],
        ])('rejects descriptions that would become a block (%s)', (_label, description) => {
            expect(isSectionHeaderDescriptionInline(description)).toBe(false)
        })
    })

    describe('parseSectionHeaderBody', () => {
        it('round-trips composed section headers back into fields', () => {
            const fields = { title: 'Engagement', description: 'How activated users come back week over week' }
            expect(parseSectionHeaderBody(composeSectionHeaderBody(fields))).toEqual(fields)
        })

        it('parses a heading-only section header', () => {
            expect(parseSectionHeaderBody('## Just a title\n\n---')).toEqual({ title: 'Just a title', description: '' })
        })

        it.each([
            ['empty string', ''],
            ['whitespace only', '   '],
            ['plain paragraph with no heading', 'just some text'],
            ['a section header that lost its trailing divider', '## Title\n\nSome description'],
            ['a heading with no divider', '## Title'],
            ['an h1 heading instead of h2', '# Title\n\n---'],
            ['an h3 heading instead of h2', '### Title\n\n---'],
            ['a markdown list', '## Title\n\n- one\n- two\n\n---'],
            ['multiple description paragraphs', '## Title\n\nfirst\n\nsecond\n\n---'],
            ['a code block', '## Title\n\n```\ncode\n```\n\n---'],
        ])('returns null for non-canonical content (%s)', (_label, body) => {
            expect(parseSectionHeaderBody(body)).toBeNull()
        })
    })

    describe('isSectionHeaderTile', () => {
        const sectionBody = composeSectionHeaderBody({ title: 'Acquisition', description: 'desc' })

        it('treats a transparent text tile with the canonical section body as a section header', () => {
            expect(isSectionHeaderTile({ text: { body: sectionBody }, transparent_background: true } as any)).toBe(true)
        })

        it('ignores a non-transparent text tile', () => {
            expect(isSectionHeaderTile({ text: { body: sectionBody }, transparent_background: false } as any)).toBe(
                false
            )
        })

        it('ignores a transparent text tile with rich (non-section) content', () => {
            expect(
                isSectionHeaderTile({
                    text: { body: '## Title\n\n- a list\n- of things' },
                    transparent_background: true,
                } as any)
            ).toBe(false)
        })

        it('ignores a transparent heading text card without the trailing divider', () => {
            expect(
                isSectionHeaderTile({ text: { body: '## Just a heading' }, transparent_background: true } as any)
            ).toBe(false)
        })

        it('ignores a transparent text card whose heading is not h2', () => {
            expect(
                isSectionHeaderTile({
                    text: { body: '### [Documentation](https://example.com)\n\n---' },
                    transparent_background: true,
                } as any)
            ).toBe(false)
        })

        it('ignores a tile without text', () => {
            expect(isSectionHeaderTile({ transparent_background: true } as any)).toBe(false)
        })
    })
})
