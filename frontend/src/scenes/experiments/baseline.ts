import type { Experiment, MultivariateFlagVariant } from '~/types'

export const LEGACY_CONTROL_VARIANT_KEY = 'control'

export const getExplicitBaselineVariantKey = (experiment?: Pick<Experiment, 'stats_config'>): string | undefined => {
    const baselineVariantKey = experiment?.stats_config?.baseline_variant_key
    return baselineVariantKey || undefined
}

export const resolveBaselineVariantKey = (
    variants: Pick<MultivariateFlagVariant, 'key'>[],
    experiment?: Pick<Experiment, 'stats_config'>
): string | undefined => {
    const variantKeys = variants.map(({ key }) => key)
    const explicitBaselineVariantKey = getExplicitBaselineVariantKey(experiment)

    if (explicitBaselineVariantKey) {
        return explicitBaselineVariantKey
    }

    return variantKeys.includes(LEGACY_CONTROL_VARIANT_KEY) ? LEGACY_CONTROL_VARIANT_KEY : variantKeys[0]
}

export const isBaselineVariantKeyValid = (
    variants: Pick<MultivariateFlagVariant, 'key'>[],
    baselineVariantKey: string | undefined
): boolean => !baselineVariantKey || variants.some(({ key }) => key === baselineVariantKey)
