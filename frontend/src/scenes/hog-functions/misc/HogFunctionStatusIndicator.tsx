import { forwardRef, type ComponentProps } from 'react'

import { IconCheckCircle, IconPause, IconWarning, IconX } from '@posthog/icons'
import { LemonDropdown, LemonTag, LemonTagProps } from '@posthog/lemon-ui'

import { HogFunctionType, HogWatcherState } from '~/types'

export type HogFunctionStatusDisplay = {
    tagType: LemonTagProps['type']
    display: string
    description: JSX.Element
    icon: JSX.Element
    ariaLabel: string
}

const displayMap: Record<HogWatcherState, HogFunctionStatusDisplay> = {
    [HogWatcherState.healthy]: {
        tagType: 'success',
        display: 'Active',
        description: <>The function is running as expected.</>,
        icon: <IconCheckCircle aria-hidden="true" className="shrink-0" />,
        ariaLabel: 'Function status: Active',
    },
    [HogWatcherState.overflowed]: {
        tagType: 'warning',
        display: 'Degraded',
        description: (
            <>
                The function is running slow or has issues performing async requests. It has been moved to the slow lane
                and may be processing slower than usual.
            </>
        ),
        icon: <IconWarning aria-hidden="true" className="shrink-0" />,
        ariaLabel: 'Function status: Degraded',
    },
    [HogWatcherState.disabled]: {
        tagType: 'danger',
        display: 'Disabled',
        description: (
            <>
                The function has been disabled indefinitely due to too many slow or failed requests. Please check your
                config. Updating your function will re-enable it.
            </>
        ),
        icon: <IconX aria-hidden="true" className="shrink-0" />,
        ariaLabel: 'Function status: Disabled',
    },
    [HogWatcherState.forcefully_degraded]: {
        tagType: 'warning',
        display: 'Degraded',
        description: (
            <>
                The function has been forcefully marked as degraded by a PostHog admin. This means it is moved to a
                separate processing queue and may experience delays or increased failures.
            </>
        ),
        icon: <IconWarning aria-hidden="true" className="shrink-0" />,
        ariaLabel: 'Function status: Degraded',
    },
    [HogWatcherState.forcefully_disabled]: {
        tagType: 'danger',
        display: 'Disabled',
        description: <>The function has been forcefully disabled by a PostHog admin. Please contact support.</>,
        icon: <IconX aria-hidden="true" className="shrink-0" />,
        ariaLabel: 'Function status: Disabled',
    },
}

const DEFAULT_DISPLAY: HogFunctionStatusDisplay = {
    tagType: 'success',
    display: 'Active',
    description: (
        <>
            The function is enabled but the function status is unknown. The status will be derived once enough
            invocations have been performed.
        </>
    ),
    icon: <IconCheckCircle aria-hidden="true" className="shrink-0" />,
    ariaLabel: 'Function status: Active',
}

const DISABLED_MANUALLY_DISPLAY: HogFunctionStatusDisplay = {
    tagType: 'default',
    display: 'Paused',
    description: <>This function is paused</>,
    icon: <IconPause aria-hidden="true" className="shrink-0" />,
    ariaLabel: 'Function status: Paused',
}

export type HogFunctionStatusIndicatorProps = {
    hogFunction: HogFunctionType | null
}

const HIDE_STATUS_FOR_TYPES: HogFunctionType['type'][] = ['site_destination', 'site_app']

export function getHogFunctionStatusDisplay(hogFunction: HogFunctionType): HogFunctionStatusDisplay {
    if (!hogFunction.enabled) {
        return DISABLED_MANUALLY_DISPLAY
    }

    return hogFunction.status?.state ? (displayMap[hogFunction.status.state] ?? DEFAULT_DISPLAY) : DEFAULT_DISPLAY
}

type StatusTagProps = Omit<ComponentProps<typeof LemonTag>, 'children' | 'icon' | 'type'> & {
    statusDisplay: HogFunctionStatusDisplay
}

const StatusTag = forwardRef<HTMLDivElement, StatusTagProps>(function StatusTag(
    { statusDisplay, ...props },
    ref
): JSX.Element {
    return (
        <LemonTag
            ref={ref}
            {...props}
            type={statusDisplay.tagType}
            icon={statusDisplay.icon}
            aria-label={statusDisplay.ariaLabel}
            data-attr="hog-function-status-indicator"
        >
            {statusDisplay.display}
        </LemonTag>
    )
})

export function HogFunctionStatusIndicator({ hogFunction }: HogFunctionStatusIndicatorProps): JSX.Element | null {
    if (!hogFunction || HIDE_STATUS_FOR_TYPES.includes(hogFunction.type)) {
        return null
    }

    const statusDisplay = getHogFunctionStatusDisplay(hogFunction)

    return (
        <LemonDropdown
            overlay={
                <>
                    <div className="p-2 deprecated-space-y-2 max-w-120">
                        <h2 className="flex gap-2 items-center m-0">
                            Function status - <StatusTag statusDisplay={statusDisplay} />
                        </h2>

                        <p>{statusDisplay.description}</p>
                    </div>
                </>
            }
        >
            <StatusTag statusDisplay={statusDisplay} />
        </LemonDropdown>
    )
}
