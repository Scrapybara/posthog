import { liveActivitySampleResult } from '../activity/liveActivitySampleData'
import { LiveActivityPulse } from '../activity/LiveActivityWidget'

export function LiveActivityWidgetPreview(): JSX.Element {
    return (
        <div className="flex flex-col gap-2 rounded border border-primary bg-bg-light p-3 shadow-sm">
            <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold leading-none">{liveActivitySampleResult.activeUsers}</span>
                <span className="text-xs text-muted">active users</span>
            </div>
            <LiveActivityPulse pulse={liveActivitySampleResult.pulse ?? []} />
            <div className="flex flex-col gap-1 text-xs text-muted">
                {liveActivitySampleResult.events?.slice(0, 3).map((event) => (
                    <div key={event.uuid} className="flex min-w-0 items-center gap-2">
                        <span className="w-14 shrink-0 uppercase">{event.surface}</span>
                        <span className="truncate">{event.event}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}
