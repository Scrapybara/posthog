import { TooltipItem } from 'lib/Chart'
import { getFormattedDate, SeriesDatum } from 'scenes/insights/InsightTooltip/insightTooltipUtils'

import { DateRange } from '~/queries/schema/schema-general'
import { GraphDataset, IntervalType } from '~/types'

export interface TooltipDataOptions {
    interval?: IntervalType | null
    dateRange?: DateRange | null
    timezone?: string
    weekStartDay?: number
}

export function createTooltipData(
    tooltipDataPoints: TooltipItem<any>[],
    filterFn?: (s: SeriesDatum) => boolean,
    options?: TooltipDataOptions
): SeriesDatum[] {
    if (!tooltipDataPoints) {
        return []
    }
    let data = tooltipDataPoints
        .map((dp, idx) => {
            const pointDataset = (dp?.dataset ?? {}) as GraphDataset
            const date = pointDataset?.days?.[dp.dataIndex]
            const dateLabel =
                typeof date === 'string'
                    ? getFormattedDate(date, {
                          interval: options?.interval,
                          dateRange: options?.dateRange,
                          timezone: options?.timezone,
                          weekStartDay: options?.weekStartDay,
                      })
                    : (pointDataset?.labels?.[dp.dataIndex] ?? undefined)
            return {
                id: idx,
                dataIndex: dp.dataIndex,
                datasetIndex: dp.datasetIndex,
                seriesIndex: dp.dataIndex,
                dotted: !!pointDataset?.dotted,
                breakdown_value:
                    pointDataset?.breakdown_value ??
                    pointDataset?.breakdownLabels?.[dp.dataIndex] ??
                    pointDataset?.breakdownValues?.[dp.dataIndex] ??
                    undefined,
                compare_label: pointDataset?.compare_label ?? pointDataset?.compareLabels?.[dp.dataIndex] ?? undefined,
                action: pointDataset?.action ?? pointDataset?.actions?.[dp.dataIndex] ?? undefined,
                label: pointDataset?.label ?? pointDataset.labels?.[dp.dataIndex] ?? undefined,
                date_label: dateLabel,
                order: pointDataset?.order ?? 0,
                color: Array.isArray(pointDataset.borderColor)
                    ? pointDataset.borderColor?.[dp.dataIndex]
                    : pointDataset.borderColor,
                count: pointDataset?.data?.[dp.dataIndex] || 0,
                filter: pointDataset?.filter ?? {},
                hideTooltip: (pointDataset as any).hideTooltip,
                anomalyScore: (pointDataset as any).anomalyScores?.[dp.dataIndex],
            }
        })
        .sort((a, b) => {
            // Sort by descending order and fallback on alphabetic sort
            return (
                b.count - a.count ||
                (a.label === undefined || b.label === undefined ? -1 : a.label.localeCompare(b.label))
            )
        })

    if (filterFn) {
        data = data.filter(filterFn)
    }

    return data.map((s, id) => ({
        ...s,
        id,
    }))
}
