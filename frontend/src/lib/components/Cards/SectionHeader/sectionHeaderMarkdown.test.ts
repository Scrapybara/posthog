import { composeSectionHeaderBody, isSectionHeaderTile, parseSectionHeaderBody } from './sectionHeaderMarkdown'

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
        ])('preserves normal punctuation verbatim through a round-trip (%s)', (title) => {
            const fields = { title, description: 'supporting copy with (parens), commas & dashes - like this' }
            expect(parseSectionHeaderBody(composeSectionHeaderBody(fields))).toEqual(fields)
        })

        it('keeps the section shape when the description starts with a list marker', () => {
            const body = composeSectionHeaderBody({ title: 'Retention', description: '- churned users last month' })
            const parsed = parseSectionHeaderBody(body)
            expect(parsed).not.toBeNull()
            expect(parsed?.title).toBe('Retention')
            expect(parsed?.description).toBe('churned users last month')
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

        it('parses a section header that lost its trailing divider', () => {
            expect(parseSectionHeaderBody('## Title\n\nSome description')).toEqual({
                title: 'Title',
                description: 'Some description',
            })
        })

        it.each([
            ['empty string', ''],
            ['whitespace only', '   '],
            ['plain paragraph with no heading', 'just some text'],
            ['a markdown list', '## Title\n\n- one\n- two'],
            ['multiple description paragraphs', '## Title\n\nfirst\n\nsecond'],
            ['a code block', '## Title\n\n```\ncode\n```'],
        ])('returns null for non-section content (%s)', (_label, body) => {
            expect(parseSectionHeaderBody(body)).toBeNull()
        })
    })

    describe('isSectionHeaderTile', () => {
        const sectionBody = composeSectionHeaderBody({ title: 'Acquisition', description: 'desc' })

        it('treats a transparent text tile with section-shaped body as a section header', () => {
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

        it('ignores an existing transparent text tile that has a heading but no section divider', () => {
            expect(
                isSectionHeaderTile({
                    text: { body: '## Existing text card\n\nA normal transparent text card' },
                    transparent_background: true,
                } as any)
            ).toBe(false)
        })

        it('ignores a tile without text', () => {
            expect(isSectionHeaderTile({ transparent_background: true } as any)).toBe(false)
        })
    })
})
