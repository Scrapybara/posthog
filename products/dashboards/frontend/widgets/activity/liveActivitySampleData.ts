import type { LiveActivityWidgetResult } from './LiveActivityWidget'

export const liveActivitySamplePulse = [3, 5, 8, 6, 10, 11, 14, 12, 15, 18, 19, 17, 21, 24, 22, 29, 25, 31, 28, 34].map(
    (count, index) => ({
        bucketStart: `2026-06-17T11:${String(55 + Math.floor(index / 4)).padStart(2, '0')}:${String(
            (index % 4) * 15
        ).padStart(2, '0')}.000Z`,
        count,
    })
)

export const liveActivitySampleResult: LiveActivityWidgetResult = {
    activeUsers: 42,
    eventsInWindow: 186,
    peakEventsPerMinute: 118,
    pulse: liveActivitySamplePulse,
    events: [
        {
            uuid: 'event-live-1',
            event: '$pageview',
            person: { display_name: 'Alex Chen', distinct_id: 'alex@example.test' },
            surface: 'web',
            target: '/pricing',
            lib: 'web',
            timestamp: '2026-06-17T11:59:50.000Z',
        },
        {
            uuid: 'event-live-2',
            event: 'Signup completed',
            person: { display_name: 'Dana Okafor', distinct_id: 'dana@example.test' },
            surface: 'mobile',
            target: 'SignupView',
            lib: 'ios',
            timestamp: '2026-06-17T11:59:43.000Z',
        },
        {
            uuid: 'event-live-3',
            event: 'File uploaded',
            person: { display_name: 'Sam Rivera', distinct_id: 'sam@example.test' },
            surface: 'backend',
            target: 'api.uploads.create',
            lib: 'python',
            timestamp: '2026-06-17T11:59:29.000Z',
        },
        {
            uuid: 'event-live-4',
            event: '$screen',
            person: { display_name: 'Jordan Lee', distinct_id: 'jordan@example.test' },
            surface: 'mobile',
            target: 'Dashboard',
            lib: 'android',
            timestamp: '2026-06-17T11:59:12.000Z',
        },
        {
            uuid: 'event-live-5',
            event: 'Checkout started',
            person: { display_name: 'Priya Shah', distinct_id: 'priya@example.test' },
            surface: 'web',
            target: '/checkout',
            lib: 'web',
            timestamp: '2026-06-17T11:58:58.000Z',
        },
    ],
    limit: 5,
    rollingWindowSeconds: 300,
    bucketSeconds: 15,
    refreshIntervalSeconds: 15,
    generatedAt: '2026-06-17T12:00:00.000Z',
    windowStart: '2026-06-17T11:55:00.000Z',
    latestEventTimestamp: '2026-06-17T11:59:50.000Z',
    delayedAfterSeconds: 60,
}

export const liveActivityDelayedResult: LiveActivityWidgetResult = {
    ...liveActivitySampleResult,
    activeUsers: 3,
    eventsInWindow: 9,
    latestEventTimestamp: '2026-06-17T11:57:45.000Z',
    events: (liveActivitySampleResult.events ?? []).slice(0, 2),
}

export const liveActivityEmptyResult: LiveActivityWidgetResult = {
    ...liveActivitySampleResult,
    activeUsers: 0,
    eventsInWindow: 0,
    peakEventsPerMinute: 0,
    pulse: liveActivitySamplePulse.map((bucket) => ({ ...bucket, count: 0 })),
    events: [],
    latestEventTimestamp: null,
}
