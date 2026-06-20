import clsx from 'clsx'
import { BindLogic, useActions, useValues } from 'kea'

import { IconPauseFilled, IconPlayFilled, IconRefresh } from '@posthog/icons'

import { DetectiveHog } from 'lib/components/hedgehogs'
import { PropertyKeyInfo } from 'lib/components/PropertyKeyInfo'
import { TaxonomicFilterGroupType } from 'lib/components/TaxonomicFilter/types'
import { TZLabel } from 'lib/components/TZLabel'
import { dayjs } from 'lib/dayjs'
import { LemonButton } from 'lib/lemon-ui/LemonButton'
import { LemonSkeleton } from 'lib/lemon-ui/LemonSkeleton'
import { Link } from 'lib/lemon-ui/Link'
import { PersonDisplay } from 'scenes/persons/PersonDisplay'
import { urls } from 'scenes/urls'

import {
    WidgetCardBodyMessage,
    WidgetCardContent,
    WidgetContentFooter,
    WidgetListCount,
} from '../../components/WidgetCard'
import type { DashboardWidgetComponentProps } from '../registry'
import { parseLiveActivityWidgetConfig } from './liveActivityWidgetConfigValidation'
import { liveActivityWidgetLogic } from './liveActivityWidgetLogic'

export type LiveActivitySurface = 'web' | 'mobile' | 'backend'

export type LiveActivityWidgetEvent = {
    uuid: string
    event: string
    person: { display_name?: string | null; distinct_id?: string | null } | null
    target: string | null
    lib: string | null
    surface: LiveActivitySurface
    timestamp: string | null
}

export type LiveActivityPulseBucket = {
    bucketStart: string
    count: number
}

export type LiveActivityWidgetResult = {
    activeUsers?: number
    eventsInWindow?: number
    peakEventsPerMinute?: number
    pulse?: LiveActivityPulseBucket[]
    events?: LiveActivityWidgetEvent[]
    limit?: number
    rollingWindowSeconds?: number
    bucketSeconds?: number
    refreshIntervalSeconds?: number
    generatedAt?: string
    windowStart?: string
    latestEventTimestamp?: string | null
    delayedAfterSeconds?: number
}

const LIVE_ACTIVITY_SURFACE_LABELS: Record<LiveActivitySurface, string> = {
    web: 'Web',
    mobile: 'Mobile',
    backend: 'Backend',
}

const LIVE_ACTIVITY_SURFACE_CLASSES: Record<LiveActivitySurface, string> = {
    web: 'bg-accent-highlight-secondary text-accent',
    mobile: 'bg-warning-highlight text-warning',
    backend: 'bg-surface-secondary text-secondary',
}

function formatCompactNumber(value: number | null | undefined): string {
    return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value ?? 0)
}

function formatWindow(seconds: number | null | undefined): string {
    const safeSeconds = seconds ?? 300
    if (safeSeconds % 60 === 0) {
        return `${safeSeconds / 60} min`
    }
    return `${safeSeconds}s`
}

function buildPulsePath(pulse: LiveActivityPulseBucket[], width: number, height: number): string {
    if (pulse.length === 0) {
        return ''
    }

    const maxCount = Math.max(...pulse.map((bucket) => bucket.count), 1)
    return pulse
        .map((bucket, index) => {
            const x = pulse.length === 1 ? width : (index / (pulse.length - 1)) * width
            const y = height - (bucket.count / maxCount) * height
            return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
        })
        .join(' ')
}

function buildPulseAreaPath(pulse: LiveActivityPulseBucket[], width: number, height: number): string {
    const linePath = buildPulsePath(pulse, width, height)
    if (!linePath) {
        return ''
    }
    return `${linePath} L ${width} ${height} L 0 ${height} Z`
}

function isResultDelayed(payload: LiveActivityWidgetResult): boolean {
    if (!payload.generatedAt || !payload.latestEventTimestamp) {
        return false
    }

    return (
        dayjs(payload.generatedAt).diff(dayjs(payload.latestEventTimestamp), 'second') >=
        (payload.delayedAfterSeconds ?? 60)
    )
}

export function LiveActivityPulse({ pulse }: { pulse: LiveActivityPulseBucket[] }): JSX.Element {
    const width = 240
    const height = 48
    const linePath = buildPulsePath(pulse, width, height)
    const areaPath = buildPulseAreaPath(pulse, width, height)

    return (
        <div className="min-h-12 min-w-0 flex-1" data-attr="live-activity-widget-pulse">
            <svg
                aria-label="Activity pulse over the last 5 minutes"
                className="h-12 w-full overflow-visible"
                preserveAspectRatio="none"
                role="img"
                viewBox={`0 0 ${width} ${height}`}
            >
                {areaPath ? <path d={areaPath} className="fill-accent opacity-10" /> : null}
                {linePath ? <path d={linePath} className="fill-none stroke-accent" strokeWidth="3" /> : null}
            </svg>
        </div>
    )
}

function LiveActivityWidgetSkeleton(): JSX.Element {
    return (
        <WidgetCardContent>
            <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-2">
                        <LemonSkeleton className="h-8 w-24" />
                        <LemonSkeleton className="h-4 w-36" />
                    </div>
                    <LemonSkeleton className="h-7 w-24 rounded" />
                </div>
                <LemonSkeleton className="h-12 w-full" />
                <div className="flex flex-col gap-2">
                    {Array.from({ length: 3 }, (_, index) => (
                        <LemonSkeleton key={index} className="h-8 w-full" />
                    ))}
                </div>
            </div>
        </WidgetCardContent>
    )
}

function LiveActivityEventRow({ event }: { event: LiveActivityWidgetEvent }): JSX.Element {
    const content = (
        <div
            className="flex min-w-0 flex-col gap-1 rounded px-2 py-1.5 hover:bg-surface-secondary"
            data-attr="live-activity-widget-event-row"
        >
            <div className="flex min-w-0 items-center gap-2">
                <span
                    className={clsx(
                        'shrink-0 rounded px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase leading-none',
                        LIVE_ACTIVITY_SURFACE_CLASSES[event.surface]
                    )}
                >
                    {LIVE_ACTIVITY_SURFACE_LABELS[event.surface]}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    <PropertyKeyInfo value={event.event} type={TaxonomicFilterGroupType.Events} disablePopover />
                </span>
                {event.timestamp ? (
                    <span className="shrink-0 truncate text-right text-xs text-muted @max-[360px]/widget-card:hidden">
                        <TZLabel time={event.timestamp} />
                    </span>
                ) : null}
            </div>
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
                {event.person ? (
                    <PersonDisplay
                        person={{
                            distinct_id: event.person.distinct_id ?? undefined,
                            properties: {},
                        }}
                        displayName={event.person.display_name ?? event.person.distinct_id ?? undefined}
                        className="min-w-0 max-w-40 shrink-0 [&>span]:min-w-0"
                        withIcon
                        noLink
                        noPopover
                    />
                ) : null}
                {event.target ? <span className="min-w-0 truncate">{event.target}</span> : null}
            </div>
        </div>
    )

    if (!event.timestamp) {
        return content
    }

    return (
        <Link to={urls.event(event.uuid, event.timestamp)} target="_blank" subtle>
            {content}
        </Link>
    )
}

function LiveActivityWidgetContents({ result, loading }: DashboardWidgetComponentProps): JSX.Element {
    const { isPaused } = useValues(liveActivityWidgetLogic)
    const { pauseAutoRefresh, resumeAutoRefresh, manualRefresh } = useActions(liveActivityWidgetLogic)
    const payload = result as LiveActivityWidgetResult | null | undefined
    const events = payload?.events ?? []
    const pulse = payload?.pulse ?? []
    const activeUsers = payload?.activeUsers ?? 0
    const eventsInWindow = payload?.eventsInWindow ?? 0
    const rollingWindowSeconds = payload?.rollingWindowSeconds ?? 300
    const isDelayed = payload ? isResultDelayed(payload) : false

    if (loading && !payload) {
        return <LiveActivityWidgetSkeleton />
    }

    if (!payload || (events.length === 0 && eventsInWindow === 0)) {
        return (
            <WidgetCardContent>
                <WidgetCardBodyMessage>
                    <div
                        className="flex max-w-xs flex-col items-center gap-2 px-2 text-balance"
                        data-attr="live-activity-widget-empty-state"
                    >
                        <DetectiveHog className="size-20 shrink-0" />
                        <p className="m-0 text-base font-semibold text-primary">No live activity yet</p>
                        <p className="m-0 text-sm text-muted">
                            No events were captured in the last {formatWindow(rollingWindowSeconds)}.
                        </p>
                    </div>
                </WidgetCardBodyMessage>
            </WidgetCardContent>
        )
    }

    return (
        <>
            <WidgetCardContent>
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                    <div className="flex min-w-0 items-start justify-between gap-3 @max-[360px]/widget-card:flex-col">
                        <div className="min-w-0">
                            <div className="flex items-baseline gap-2">
                                <span className="text-3xl font-semibold leading-none" data-attr="live-active-users">
                                    {formatCompactNumber(activeUsers)}
                                </span>
                                <span className="text-sm text-muted">active users</span>
                            </div>
                            <div className="mt-1 text-xs text-muted">
                                Last {formatWindow(rollingWindowSeconds)} · {formatCompactNumber(eventsInWindow)} events
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <span
                                className={clsx(
                                    'rounded px-2 py-1 text-xs font-medium',
                                    isPaused
                                        ? 'bg-warning-highlight text-warning'
                                        : isDelayed
                                          ? 'bg-warning-highlight text-warning'
                                          : 'bg-success-highlight text-success'
                                )}
                                data-attr="live-activity-widget-status"
                            >
                                {isPaused ? 'Paused' : isDelayed ? 'Delayed' : 'Live'}
                            </span>
                            <LemonButton
                                aria-label={isPaused ? 'Resume live activity refresh' : 'Pause live activity refresh'}
                                icon={isPaused ? <IconPlayFilled /> : <IconPauseFilled />}
                                onClick={isPaused ? resumeAutoRefresh : pauseAutoRefresh}
                                size="xsmall"
                                type="secondary"
                            />
                            <LemonButton
                                aria-label="Refresh live activity now"
                                disabledReason={loading ? 'Refreshing…' : undefined}
                                icon={<IconRefresh />}
                                onClick={manualRefresh}
                                size="xsmall"
                                type="secondary"
                            />
                        </div>
                    </div>

                    <LiveActivityPulse pulse={pulse} />

                    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                        {events.map((event) => (
                            <LiveActivityEventRow key={event.uuid} event={event} />
                        ))}
                    </div>
                </div>
            </WidgetCardContent>
            <WidgetContentFooter>
                <div className="flex min-w-0 flex-1 items-center justify-between gap-2 text-xs text-muted">
                    <WidgetListCount
                        shown={events.length}
                        totalCount={eventsInWindow}
                        noun={{ singular: 'recent event', plural: 'recent events' }}
                        hasMore={eventsInWindow > events.length}
                        dataAttr="live-activity-widget-count"
                    />
                    <span className="truncate">
                        Refreshes every {payload.refreshIntervalSeconds ?? 15}s · hidden tabs pause
                    </span>
                </div>
            </WidgetContentFooter>
        </>
    )
}

export function LiveActivityWidget({
    config,
    tileId,
    loading,
    onRefresh,
    onRefreshData,
    ...props
}: DashboardWidgetComponentProps): JSX.Element {
    const parsedConfig = parseLiveActivityWidgetConfig(config)

    return (
        <BindLogic
            logic={liveActivityWidgetLogic}
            props={{
                tileId,
                refreshIntervalSeconds: parsedConfig.refreshIntervalSeconds,
                loading,
                onRefresh,
                onRefreshData,
            }}
        >
            <LiveActivityWidgetContents
                {...props}
                config={parsedConfig}
                loading={loading}
                onRefresh={onRefresh}
                onRefreshData={onRefreshData}
                tileId={tileId}
            />
        </BindLogic>
    )
}
