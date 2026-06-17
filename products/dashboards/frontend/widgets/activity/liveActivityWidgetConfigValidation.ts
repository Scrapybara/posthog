import { z } from 'zod'

import { ApiError } from 'lib/api-error'

import {
    liveActivityWidgetConfigSchema,
    liveActivityWidgetFormSchema,
    type LiveActivityWidgetConfig,
} from '../../generated/widget-configs.zod'
import { fieldErrorsFromZodError, parseWidgetConfig } from '../widgetConfigValidation'

export const LIVE_ACTIVITY_WIDGET_FORM_FIELD_NAMES = Object.keys(
    liveActivityWidgetFormSchema.shape
) as (keyof typeof liveActivityWidgetFormSchema.shape)[]

type LiveActivityWidgetFormField = keyof z.infer<typeof liveActivityWidgetFormSchema>

export type LiveActivityWidgetFieldErrors = Partial<Record<LiveActivityWidgetFormField, string>>

export type LiveActivityWidgetFormInput = {
    limit: number
    refreshIntervalSeconds: number
    filterTestAccounts: boolean | null
}

const liveActivityConfigDefaults = liveActivityWidgetConfigSchema.parse({})

function addIntegerFieldIssues(
    data: Pick<LiveActivityWidgetFormInput, 'limit' | 'refreshIntervalSeconds'>,
    context: z.RefinementCtx
): void {
    if (!Number.isInteger(data.limit)) {
        context.addIssue({ code: 'custom', path: ['limit'], message: 'Expected integer' })
    }
    if (!Number.isInteger(data.refreshIntervalSeconds)) {
        context.addIssue({ code: 'custom', path: ['refreshIntervalSeconds'], message: 'Expected integer' })
    }
}

const strictLiveActivityWidgetFormSchema = liveActivityWidgetFormSchema.superRefine(addIntegerFieldIssues)
const strictLiveActivityWidgetConfigSchema = liveActivityWidgetConfigSchema.superRefine(addIntegerFieldIssues)

export function parseLiveActivityWidgetConfig(config: Record<string, unknown>): LiveActivityWidgetConfig {
    return parseWidgetConfig(liveActivityWidgetConfigSchema, config)
}

export function buildLiveActivityWidgetConfig(
    formInput: LiveActivityWidgetFormInput,
    baseConfig: LiveActivityWidgetConfig
): LiveActivityWidgetConfig {
    return strictLiveActivityWidgetConfigSchema.parse({
        ...baseConfig,
        ...formInput,
    })
}

export function validateLiveActivityWidgetConfigInput(input: {
    limit: number
    refreshIntervalSeconds: number
    filterTestAccounts: boolean
    baseConfig: LiveActivityWidgetConfig
}):
    | { success: true; config: LiveActivityWidgetConfig }
    | { success: false; fieldErrors: LiveActivityWidgetFieldErrors } {
    const parsed = strictLiveActivityWidgetFormSchema.safeParse({
        limit: input.limit,
        refreshIntervalSeconds: input.refreshIntervalSeconds,
        filterTestAccounts: input.filterTestAccounts,
    })

    if (!parsed.success) {
        return { success: false, fieldErrors: fieldErrorsFromZodError(parsed.error) }
    }

    return {
        success: true,
        config: buildLiveActivityWidgetConfig(
            {
                limit: parsed.data.limit,
                refreshIntervalSeconds: parsed.data.refreshIntervalSeconds,
                filterTestAccounts: parsed.data.filterTestAccounts ?? null,
            },
            input.baseConfig
        ),
    }
}

export function parseLiveActivityWidgetConfigApiError(
    error: unknown,
    config: Record<string, unknown>
): LiveActivityWidgetFieldErrors | null {
    if (!(error instanceof ApiError)) {
        return null
    }

    const parsedConfig = strictLiveActivityWidgetConfigSchema.safeParse(config)
    if (parsedConfig.success) {
        return null
    }

    const parsedForm = strictLiveActivityWidgetFormSchema.safeParse({
        limit: (config.limit as number) ?? liveActivityConfigDefaults.limit ?? 0,
        refreshIntervalSeconds:
            (config.refreshIntervalSeconds as number) ?? liveActivityConfigDefaults.refreshIntervalSeconds ?? 0,
        filterTestAccounts: (config.filterTestAccounts as boolean) ?? false,
    })
    if (!parsedForm.success) {
        return fieldErrorsFromZodError(parsedForm.error)
    }

    return fieldErrorsFromZodError(parsedConfig.error)
}
