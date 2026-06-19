import { AccountHealthStatus } from '~/queries/schema/schema-general'

import { healthScoreColor, healthStatusTagType, parseAccountHealth } from './accountHealth'

describe('accountHealth', () => {
    describe('parseAccountHealth', () => {
        it('parses a full health score with factors', () => {
            const parsed = parseAccountHealth({
                score: 91,
                status: 'healthy',
                factors: [
                    {
                        metric_id: 'm-events',
                        metric_name: 'Events ingested',
                        interval: 7,
                        current: 920,
                        previous: 1000,
                        factor_score: 92,
                        change_pct: -8,
                    },
                ],
            })
            expect(parsed).toEqual({
                score: 91,
                status: 'healthy',
                factors: [
                    {
                        metric_id: 'm-events',
                        metric_name: 'Events ingested',
                        interval: 7,
                        current: 920,
                        previous: 1000,
                        factor_score: 92,
                        change_pct: -8,
                    },
                ],
            })
        })

        it('parses a no_data score with no factors', () => {
            expect(parseAccountHealth({ score: null, status: 'no_data', factors: [] })).toEqual({
                score: null,
                status: 'no_data',
                factors: [],
            })
        })

        it('coerces a non-numeric score and nullable fields to null', () => {
            const parsed = parseAccountHealth({
                score: 'oops',
                status: 'at_risk',
                factors: [
                    {
                        metric_id: 'm',
                        metric_name: 'Metric',
                        interval: 7,
                        current: 0,
                        previous: 0,
                        factor_score: null,
                        change_pct: null,
                    },
                ],
            })
            expect(parsed?.score).toBeNull()
            expect(parsed?.factors[0].factor_score).toBeNull()
            expect(parsed?.factors[0].change_pct).toBeNull()
        })

        it('drops malformed factors but keeps valid ones', () => {
            const parsed = parseAccountHealth({
                score: 50,
                status: 'needs_attention',
                factors: [
                    { metric_name: 'missing id' },
                    {
                        metric_id: 'ok',
                        metric_name: 'Good',
                        interval: 7,
                        current: 1,
                        previous: 2,
                        factor_score: 50,
                        change_pct: -50,
                    },
                ],
            })
            expect(parsed?.factors).toHaveLength(1)
            expect(parsed?.factors[0].metric_id).toBe('ok')
        })

        it.each([[null], [undefined], ['health'], [42], [{ status: 'bogus', factors: [] }], [{ factors: [] }]])(
            'returns null for unrecognized cell %p',
            (value) => {
                expect(parseAccountHealth(value)).toBeNull()
            }
        )
    })

    describe('healthStatusTagType', () => {
        it.each([
            ['healthy', 'success'],
            ['needs_attention', 'warning'],
            ['at_risk', 'danger'],
            ['no_data', 'muted'],
        ] as [AccountHealthStatus, string][])('maps %s to the %s tag', (status, expected) => {
            expect(healthStatusTagType(status)).toBe(expected)
        })
    })

    describe('healthScoreColor', () => {
        it('buckets scores by threshold and handles null', () => {
            expect(healthScoreColor(90)).toBe('var(--color-success)')
            expect(healthScoreColor(80)).toBe('var(--color-success)')
            expect(healthScoreColor(60)).toBe('var(--color-warning)')
            expect(healthScoreColor(50)).toBe('var(--color-warning)')
            expect(healthScoreColor(20)).toBe('var(--color-danger)')
            expect(healthScoreColor(null)).toBe('var(--color-text-tertiary)')
        })
    })
})
