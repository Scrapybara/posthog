import { actions, afterMount, kea, key, listeners, path, props, propsChanged, reducers } from 'kea'

import type { liveActivityWidgetLogicType } from './liveActivityWidgetLogicType'

export type LiveActivityWidgetLogicProps = {
    tileId: number
    refreshIntervalSeconds: number
    loading?: boolean
    onRefresh?: () => void
    onRefreshData?: () => void
}

const LIVE_ACTIVITY_AUTO_REFRESH_KEY = 'liveActivityAutoRefresh'
const MIN_LIVE_ACTIVITY_REFRESH_INTERVAL_SECONDS = 15

function triggerScheduledRefresh(cache: Record<string, unknown>): void {
    const refresh = (cache.onRefreshData ?? cache.onRefresh) as (() => void) | undefined
    refresh?.()
}

function triggerManualRefresh(cache: Record<string, unknown>): void {
    const refresh = (cache.onRefresh ?? cache.onRefreshData) as (() => void) | undefined
    refresh?.()
}

export const liveActivityWidgetLogic = kea<liveActivityWidgetLogicType>([
    props({} as LiveActivityWidgetLogicProps),
    key((props) => props.tileId),
    path((key) => ['products', 'dashboards', 'widgets', 'activity', 'liveActivityWidgetLogic', key]),

    actions({
        startAutoRefresh: true,
        pauseAutoRefresh: true,
        resumeAutoRefresh: true,
        refreshFromTimer: true,
        manualRefresh: true,
    }),

    reducers({
        isPaused: [
            false,
            {
                pauseAutoRefresh: () => true,
                resumeAutoRefresh: () => false,
            },
        ],
    }),

    listeners(({ actions, values, props, cache }) => ({
        startAutoRefresh: () => {
            cache.disposables.dispose(LIVE_ACTIVITY_AUTO_REFRESH_KEY)
            cache.onRefresh = props.onRefresh
            cache.onRefreshData = props.onRefreshData

            if (values.isPaused || (!props.onRefresh && !props.onRefreshData)) {
                return
            }

            const intervalMs = Math.max(props.refreshIntervalSeconds, MIN_LIVE_ACTIVITY_REFRESH_INTERVAL_SECONDS) * 1000

            cache.disposables.add(() => {
                const intervalId = setInterval(() => actions.refreshFromTimer(), intervalMs)
                return () => clearInterval(intervalId)
            }, LIVE_ACTIVITY_AUTO_REFRESH_KEY)
        },
        pauseAutoRefresh: () => {
            cache.disposables.dispose(LIVE_ACTIVITY_AUTO_REFRESH_KEY)
        },
        resumeAutoRefresh: () => {
            actions.startAutoRefresh()
            if (!props.loading) {
                triggerScheduledRefresh(cache)
            }
        },
        refreshFromTimer: () => {
            if (!values.isPaused && !props.loading) {
                triggerScheduledRefresh(cache)
            }
        },
        manualRefresh: () => {
            if (!props.loading) {
                triggerManualRefresh(cache)
            }
        },
    })),

    afterMount(({ actions, props, cache }) => {
        cache.onRefresh = props.onRefresh
        cache.onRefreshData = props.onRefreshData
        actions.startAutoRefresh()
    }),

    propsChanged(({ actions, props, cache }, oldProps) => {
        cache.onRefresh = props.onRefresh
        cache.onRefreshData = props.onRefreshData

        if (props.refreshIntervalSeconds !== oldProps.refreshIntervalSeconds) {
            actions.startAutoRefresh()
        }
    }),
])
