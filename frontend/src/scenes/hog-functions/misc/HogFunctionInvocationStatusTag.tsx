import { IconCheckCircle, IconClock, IconMinusSmall, IconQuestion, IconX } from '@posthog/icons'
import { LemonTag, LemonTagType } from '@posthog/lemon-ui'

export type HogFunctionInvocationStatus = 'success' | 'failure' | 'running' | 'not tested' | 'unknown'

type StatusDisplay = {
    label: string
    type: LemonTagType
    icon: JSX.Element
}

const STATUS_DISPLAY: Record<HogFunctionInvocationStatus, StatusDisplay> = {
    success: {
        label: 'Success',
        type: 'success',
        icon: <IconCheckCircle aria-hidden="true" />,
    },
    failure: {
        label: 'Failure',
        type: 'danger',
        icon: <IconX aria-hidden="true" />,
    },
    running: {
        label: 'Running',
        type: 'warning',
        icon: <IconClock aria-hidden="true" />,
    },
    'not tested': {
        label: 'Not tested',
        type: 'muted',
        icon: <IconMinusSmall aria-hidden="true" />,
    },
    unknown: {
        label: 'Unknown',
        type: 'muted',
        icon: <IconQuestion aria-hidden="true" />,
    },
}

export function HogFunctionInvocationStatusTag({ status }: { status: HogFunctionInvocationStatus }): JSX.Element {
    const { label, type, icon } = STATUS_DISPLAY[status]

    return (
        <LemonTag type={type} icon={icon} aria-label={`Status: ${label}`}>
            {label}
        </LemonTag>
    )
}
