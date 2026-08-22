import { NodeKind } from '~/queries/schema/schema-general'
import { InsightType } from '~/types'

import {
    type LegacyExperimentMetricResult,
    legacyCalculateDelta,
    legacyCredibleIntervalForVariant,
    legacyExpectedRunningTime,
    legacyMinimumSampleSizePerVariant,
    legacyRecommendedExposureForCountData,
} from './legacyExperimentCalculations'

describe('experimentCalculations', () => {
    describe('minimumSampleSizePerVariant', () => {
        it('given an mde, calculates correct sample size', () => {
            // Using the rule of thumb: sampleSize = 16 * sigma^2 / (mde^2)
            expect(legacyMinimumSampleSizePerVariant(30, 20)).toEqual(29)

            expect(legacyMinimumSampleSizePerVariant(30, 40)).toEqual(43)

            expect(legacyMinimumSampleSizePerVariant(30, 0)).toEqual(0)
        })
    })

    describe('expectedRunningTime', () => {
        it('given sample size and entrants, calculates correct running time', () => {
            // 500 entrants over 14 days, 1000 sample size, so need twice the time
            expect(legacyExpectedRunningTime(500, 1000)).toEqual(28)

            // 500 entrants over 14 days, 250 sample size, so need half the time
            expect(legacyExpectedRunningTime(500, 250)).toEqual(7)

            // 0 entrants over 14 days, so infinite running time
            expect(legacyExpectedRunningTime(0, 1000)).toEqual(Infinity)

            // Custom duration
            expect(legacyExpectedRunningTime(500, 1000, 7)).toEqual(14)
        })
    })

    describe('recommendedExposureForCountData', () => {
        it('given control count data, calculates correct exposure time', () => {
            // Using formula: 4 / (sqrt(lambda1/days) - sqrt(lambda2/days))^2

            // 1000 count over 14 days
            expect(legacyRecommendedExposureForCountData(30, 1000)).toEqual(2.8)

            // 10,000 count over 14 days - 10x count, so 1/10th running time
            expect(legacyRecommendedExposureForCountData(30, 10000)).toEqual(0.3)

            // 0 count, so should be Infinity (can't calculate with zero)
            expect(legacyRecommendedExposureForCountData(30, 0)).toEqual(Infinity)
        })
    })

    describe('configurable baseline variants', () => {
        it('calculates trend deltas and intervals against the first result variant', () => {
            const result = {
                variants: [
                    { key: 'variant-b', count: 80, absolute_exposure: 100 },
                    { key: 'control', count: 60, absolute_exposure: 100 },
                ],
                credible_intervals: { control: [0.5, 0.7] },
            } as unknown as LegacyExperimentMetricResult

            expect(legacyCalculateDelta(result, 'variant-b', InsightType.TRENDS)).toBeNull()
            expect(legacyCalculateDelta(result, 'control', InsightType.TRENDS)?.deltaPercent).toBeCloseTo(-25)
            const interval = legacyCredibleIntervalForVariant(result, 'control', InsightType.TRENDS)
            expect(interval?.[0]).toBeCloseTo(-37.5)
            expect(interval?.[1]).toBeCloseTo(-12.5)
        })

        it('calculates funnel deltas and intervals against the first result variant', () => {
            const result = {
                kind: NodeKind.ExperimentFunnelsQuery,
                variants: [
                    { key: 'variant-b', success_count: 80, failure_count: 20 },
                    { key: 'control', success_count: 60, failure_count: 40 },
                ],
                insight: [
                    [
                        { count: 100, breakdown_value: ['variant-b'] },
                        { count: 80, breakdown_value: ['variant-b'] },
                    ],
                    [
                        { count: 100, breakdown_value: ['control'] },
                        { count: 60, breakdown_value: ['control'] },
                    ],
                ],
                credible_intervals: { control: [0.5, 0.7] },
            } as unknown as LegacyExperimentMetricResult

            expect(legacyCalculateDelta(result, 'variant-b', InsightType.FUNNELS)).toBeNull()
            expect(legacyCalculateDelta(result, 'control', InsightType.FUNNELS)?.deltaPercent).toBeCloseTo(-25)
            const interval = legacyCredibleIntervalForVariant(result, 'control', InsightType.FUNNELS)
            expect(interval?.[0]).toBeCloseTo(-37.5)
            expect(interval?.[1]).toBeCloseTo(-12.5)
        })
    })
})
