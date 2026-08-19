import { IconCheckCircle, IconPause, IconWarning, IconXCircle } from '@posthog/icons'
import { LemonDropdown, LemonTag, type LemonTagProps } from '@posthog/lemon-ui'

import { HogFunctionType, HogWatcherState } from '~/types'

type DisplayOptions = {
    tagType: LemonTagProps['type']
    display: string
    description: JSX.Element
    icon: JSX.Element
}
const displayMap: Record<HogWatcherState, DisplayOptions> = {
    [HogWatcherState.healthy]: {
        tagType: 'success',
        display: 'Active',
        description: <>The function is running as expected.</>,
        icon: <IconCheckCircle className="text-success" aria-hidden="true" />,
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
        icon: <IconWarning className="text-warning" aria-hidden="true" />,
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
        icon: <IconXCircle className="text-danger" aria-hidden="true" />,
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
        icon: <IconWarning className="text-warning" aria-hidden="true" />,
    },
    [HogWatcherState.forcefully_disabled]: {
        tagType: 'danger',
        display: 'Disabled',
        description: <>The function has been forcefully disabled by a PostHog admin. Please contact support.</>,
        icon: <IconXCircle className="text-danger" aria-hidden="true" />,
    },
}

const DEFAULT_DISPLAY: DisplayOptions = {
    tagType: 'success',
    display: 'Active',
    description: (
        <>
            The function is enabled but the function status is unknown. The status will be derived once enough
            invocations have been performed.
        </>
    ),
    icon: <IconCheckCircle className="text-success" aria-hidden="true" />,
}

const DISABLED_MANUALLY_DISPLAY: DisplayOptions = {
    tagType: 'default',
    display: 'Paused',
    description: <>This function is paused</>,
    icon: <IconPause className="text-secondary" aria-hidden="true" />,
}

export type HogFunctionStatusIndicatorProps = {
    hogFunction: HogFunctionType | null
}

const HIDE_STATUS_FOR_TYPES: HogFunctionType['type'][] = ['site_destination', 'site_app']

export function HogFunctionStatusIndicator({ hogFunction }: HogFunctionStatusIndicatorProps): JSX.Element | null {
    if (!hogFunction || HIDE_STATUS_FOR_TYPES.includes(hogFunction.type)) {
        return null
    }

    const { tagType, display, description, icon } = !hogFunction.enabled
        ? DISABLED_MANUALLY_DISPLAY
        : hogFunction.status?.state
          ? displayMap[hogFunction.status.state]
          : DEFAULT_DISPLAY

    return (
        <LemonDropdown
            overlay={
                <>
                    <div className="p-2 deprecated-space-y-2 max-w-120">
                        <h2 className="flex gap-2 items-center m-0">
                            Function status -
                            <LemonTag type={tagType} icon={icon} className="!text-primary">
                                {display}
                            </LemonTag>
                        </h2>

                        <p>{description}</p>
                    </div>
                </>
            }
        >
            <LemonTag
                type={tagType}
                size="small"
                icon={icon}
                className="!text-primary"
                aria-label={`Status: ${display}`}
            >
                {display}
            </LemonTag>
        </LemonDropdown>
    )
}
