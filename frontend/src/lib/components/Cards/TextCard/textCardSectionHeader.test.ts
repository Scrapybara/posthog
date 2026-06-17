import {
    buildDashboardSectionHeaderBody,
    defaultSectionHeaderLayoutAtBottom,
    isDashboardSectionHeaderTile,
    parseDashboardSectionHeaderBody,
} from './textCardSectionHeader'

describe('textCardSectionHeader', () => {
    it('builds and parses safe section header markdown', () => {
        const body = buildDashboardSectionHeaderBody({
            title: 'Activation *funnel* #1',
            description: 'Signup < checkout & success',
        })

        expect(parseDashboardSectionHeaderBody(body)).toEqual({
            title: 'Activation *funnel* #1',
            description: 'Signup < checkout & success',
        })
        expect(body).toContain('\\*funnel\\*')
        expect(body).toContain('\\#1')
        expect(body).toContain('\\< checkout')
    })

    it('requires the section marker and transparent background to classify a tile', () => {
        expect(
            isDashboardSectionHeaderTile({
                transparent_background: true,
                text: { body: '## Looks like a header' },
            } as any)
        ).toBe(false)

        expect(
            isDashboardSectionHeaderTile({
                transparent_background: false,
                text: { body: buildDashboardSectionHeaderBody({ title: 'Header', description: '' }) },
            } as any)
        ).toBe(false)

        expect(
            isDashboardSectionHeaderTile({
                transparent_background: true,
                text: { body: buildDashboardSectionHeaderBody({ title: 'Header', description: '' }) },
            } as any)
        ).toBe(true)
    })

    it('places new section headers full width at the bottom', () => {
        expect(
            defaultSectionHeaderLayoutAtBottom([
                { y: 0, h: 3 },
                { y: 5, h: 2 },
            ])
        ).toEqual({
            sm: { x: 0, y: 7, w: 12, h: 1 },
        })
    })
})
