import { ApiError } from 'lib/api-error'

import { liveActivityWidgetConfigSchema } from '../../generated/widget-configs.zod'
import {
    LIVE_ACTIVITY_WIDGET_FORM_FIELD_NAMES,
    parseLiveActivityWidgetConfigApiError,
    validateLiveActivityWidgetConfigInput,
} from './liveActivityWidgetConfigValidation'

describe('liveActivityWidgetConfigValidation', () => {
    it('form picked fields exist on the generated config schema', () => {
        const shape = liveActivityWidgetConfigSchema.shape
        for (const field of LIVE_ACTIVITY_WIDGET_FORM_FIELD_NAMES) {
            expect(shape).toHaveProperty(field)
        }
    })

    describe('validateLiveActivityWidgetConfigInput', () => {
        it('rejects limit above 10 with inline-friendly message', () => {
            const result = validateLiveActivityWidgetConfigInput({
                limit: 11,
                refreshIntervalSeconds: 15,
                filterTestAccounts: true,
                baseConfig: liveActivityWidgetConfigSchema.parse({}),
            })

            expect(result.success).toBe(false)
            if (!result.success) {
                expect(result.fieldErrors.limit).toBe('Too big: expected number to be <=10')
            }
        })

        it('rejects refresh intervals below 15 seconds', () => {
            const result = validateLiveActivityWidgetConfigInput({
                limit: 5,
                refreshIntervalSeconds: 5,
                filterTestAccounts: true,
                baseConfig: liveActivityWidgetConfigSchema.parse({}),
            })

            expect(result.success).toBe(false)
            if (!result.success) {
                expect(result.fieldErrors.refreshIntervalSeconds).toBe('Too small: expected number to be >=15')
            }
        })

        it('accepts valid config', () => {
            const result = validateLiveActivityWidgetConfigInput({
                limit: 8,
                refreshIntervalSeconds: 30,
                filterTestAccounts: false,
                baseConfig: liveActivityWidgetConfigSchema.parse({}),
            })

            expect(result.success).toBe(true)
            if (result.success) {
                expect(result.config).toEqual({
                    limit: 8,
                    refreshIntervalSeconds: 30,
                    filterTestAccounts: false,
                })
            }
        })
    })

    describe('parseLiveActivityWidgetConfigApiError', () => {
        it('maps invalid config to zod field errors', () => {
            const error = new ApiError('limit must be an integer between 1 and 10.', 400, undefined, {
                config: 'limit must be an integer between 1 and 10.',
            })

            expect(
                parseLiveActivityWidgetConfigApiError(error, {
                    limit: 11,
                    refreshIntervalSeconds: 15,
                })
            ).toEqual({
                limit: 'Too big: expected number to be <=10',
            })
        })
    })
})
