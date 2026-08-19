import { isDashboardSectionHeader, parseDashboardSectionHeader, serializeDashboardSectionHeader } from './sectionHeader'

describe('dashboard section headers', () => {
    it('round-trips user text while retaining a markdown fallback', () => {
        const body = serializeDashboardSectionHeader({
            title: 'Activation [weekly]',
            description: 'How users reach the **key moment**. 🚀',
        })

        expect(parseDashboardSectionHeader(body)).toEqual({
            title: 'Activation [weekly]',
            description: 'How users reach the **key moment**. 🚀',
        })
        expect(body).toContain('## Activation \\[weekly\\]')
        expect(body).toContain('How users reach the \\*\\*key moment\\*\\*. 🚀')
    })

    it.each(['Regular text', '<!--posthog-dashboard-section-header:invalid-->', ''])(
        'does not identify %p as a section header',
        (body) => {
            expect(isDashboardSectionHeader(body)).toBe(false)
            expect(parseDashboardSectionHeader(body)).toBeNull()
        }
    )
})
