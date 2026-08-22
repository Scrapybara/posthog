import { describe, expect, it } from 'vitest'

import { ExperimentsPartialUpdateBody } from '@/generated/experiments/api'
import { ExperimentExposureQuerySchema } from '@/schema/experiments'

describe('Experiment schemas', () => {
    // getExposures round-trips the stored exposure_criteria through this hand-written schema,
    // and Zod 4 z.object strips unknown keys on parse, so a criteria field missing from the
    // schema silently degrades the query the backend receives.
    it('keeps every stored exposure_criteria field through a parse round-trip', () => {
        const exposureCriteria = {
            filterTestAccounts: true,
            exposure_config: {
                kind: 'ExperimentEventExposureConfig',
                event: '$feature_flag_called',
                properties: [],
            },
            activation_config: {
                kind: 'ExperimentEventExposureConfig',
                event: 'activated',
                properties: [],
            },
            multiple_variant_handling: 'exclude',
        }

        const parsed = ExperimentExposureQuerySchema.parse({
            kind: 'ExperimentExposureQuery',
            experiment_id: 1,
            experiment_name: 'test',
            exposure_criteria: exposureCriteria,
        })

        expect(parsed.exposure_criteria).toEqual(exposureCriteria)
    })

    it('preserves extension fields in stats config', () => {
        const statsConfig = {
            method: 'bayesian' as const,
            migrated_from: 123,
            bayesian: { ci_level: 0.95, extension_field: true },
        }

        const parsed = ExperimentsPartialUpdateBody.parse({ stats_config: statsConfig })

        expect(parsed.stats_config).toEqual(statsConfig)
    })
})
