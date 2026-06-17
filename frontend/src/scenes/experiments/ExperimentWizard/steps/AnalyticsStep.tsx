import { useActions, useValues } from 'kea'

import { LemonSelect } from '@posthog/lemon-ui'

import { LemonBanner } from 'lib/lemon-ui/LemonBanner'

import { ExposureCriteriaPanel } from '../../ExperimentForm/ExposureCriteriaPanel'
import { MetricsPanel } from '../../ExperimentForm/MetricsPanel'
import { resolveBaselineVariantKey } from '../../utils'
import { experimentWizardLogic } from '../experimentWizardLogic'

export function AnalyticsStep(): JSX.Element {
    const { experiment, sharedMetrics } = useValues(experimentWizardLogic)
    const { setExperiment, setExposureCriteria, setSharedMetrics } = useActions(experimentWizardLogic)

    const baselineVariants = experiment.parameters?.feature_flag_variants ?? []
    const baselineVariantKeys = baselineVariants.map((v) => v.key)
    const effectiveBaselineKey = resolveBaselineVariantKey(
        baselineVariantKeys,
        experiment.stats_config?.baseline_variant_key
    )

    return (
        <div className="space-y-6">
            <div className="space-y-4">
                <div>
                    <h3 className="text-lg font-semibold mb-1">Who is included in the analysis?</h3>
                    <ExposureCriteriaPanel experiment={experiment} onChange={setExposureCriteria} compact />
                </div>

                <div className="mt-10">
                    <h3 className="text-lg font-semibold mb-1">How to measure impact?</h3>
                    <MetricsPanel
                        experiment={experiment}
                        sharedMetrics={sharedMetrics}
                        compact
                        onSaveMetric={(metric, context) => {
                            const isNew = !experiment[context.field].some((m) => m.uuid === metric.uuid)
                            setExperiment({
                                ...experiment,
                                [context.field]: isNew
                                    ? [...experiment[context.field], metric]
                                    : experiment[context.field].map((m) => (m.uuid === metric.uuid ? metric : m)),
                            })
                        }}
                        onDeleteMetric={(metric, context) => {
                            if (metric.isSharedMetric) {
                                setExperiment({
                                    ...experiment,
                                    saved_metrics: (experiment.saved_metrics ?? []).filter(
                                        (sm) => sm.saved_metric !== metric.sharedMetricId
                                    ),
                                })
                                setSharedMetrics({
                                    ...sharedMetrics,
                                    [context.type]: sharedMetrics[context.type].filter((m) => m.uuid !== metric.uuid),
                                })
                                return
                            }
                            setExperiment({
                                ...experiment,
                                [context.field]: experiment[context.field].filter(({ uuid }) => uuid !== metric.uuid),
                            })
                        }}
                        onSaveSharedMetrics={(metrics, context) => {
                            setExperiment({
                                ...experiment,
                                saved_metrics: [
                                    ...(experiment.saved_metrics ?? []),
                                    ...metrics.map((metric) => ({
                                        saved_metric: metric.sharedMetricId,
                                    })),
                                ],
                            })
                            setSharedMetrics({
                                ...sharedMetrics,
                                [context.type]: [...sharedMetrics[context.type], ...metrics],
                            })
                        }}
                        onSaveExposureCriteria={setExposureCriteria}
                    />
                </div>
            </div>

            {baselineVariantKeys.length > 0 && (
                <div>
                    <h3 className="text-lg font-semibold mb-1">Which variant is the baseline?</h3>
                    <p className="text-muted text-sm mb-2">
                        All other variants are compared against this one. You can change it later in settings.
                    </p>
                    <LemonSelect
                        value={effectiveBaselineKey}
                        options={baselineVariants.map((v) => ({ value: v.key, label: v.key }))}
                        onChange={(value) =>
                            setExperiment({
                                ...experiment,
                                stats_config: { ...experiment.stats_config, baseline_variant_key: value },
                            })
                        }
                    />
                </div>
            )}

            <LemonBanner type="info">
                You can always refine your analytics configuration and metrics after saving.
            </LemonBanner>
        </div>
    )
}
