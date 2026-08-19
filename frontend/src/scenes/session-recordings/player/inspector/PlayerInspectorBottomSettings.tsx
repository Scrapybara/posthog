import './PlayerInspectorList.scss'

import { useActions, useValues } from 'kea'

import { BaseIcon, IconCheck, IconChevronLeft, IconChevronRight } from '@posthog/icons'
import { LemonButton } from '@posthog/lemon-ui'

import { SettingsBar, SettingsMenu, SettingsToggle } from 'lib/components/PanelSettings/PanelSettings'
import { ScrollableShadows } from 'lib/components/ScrollableShadows/ScrollableShadows'
import { userPreferencesLogic } from 'lib/logic/userPreferencesLogic'
import { miniFiltersLogic } from 'scenes/session-recordings/player/inspector/miniFiltersLogic'

import { sessionRecordingPlayerLogic } from '../sessionRecordingPlayerLogic'
import { playerInspectorLogic } from './playerInspectorLogic'
import { scrollInspectorToolbar } from './scrollInspectorToolbar'

function HideProperties(): JSX.Element {
    const { logicProps } = useValues(sessionRecordingPlayerLogic)
    const inspectorLogic = playerInspectorLogic(logicProps)

    const { hasEventsToDisplay } = useValues(inspectorLogic)
    const { hasEventsFiltersSelected } = useValues(miniFiltersLogic)

    const { hideNullValues } = useValues(userPreferencesLogic)
    const { setHideNullValues } = useActions(userPreferencesLogic)

    const { hidePostHogPropertiesInTable } = useValues(userPreferencesLogic)
    const { setHidePostHogPropertiesInTable } = useActions(userPreferencesLogic)

    return (
        <SettingsMenu
            items={[
                {
                    label: <>{hidePostHogPropertiesInTable ? <IconCheck /> : <BaseIcon />} Hide PostHog properties</>,
                    onClick: () => setHidePostHogPropertiesInTable(!hidePostHogPropertiesInTable),
                    active: hidePostHogPropertiesInTable,
                    disabledReason:
                        hasEventsToDisplay && hasEventsFiltersSelected ? undefined : 'There are no events in the list',
                },
                {
                    label: <>{hideNullValues ? <IconCheck /> : <BaseIcon />} Hide null values</>,
                    onClick: () => setHideNullValues(!hideNullValues),
                    active: hideNullValues,
                    disabledReason:
                        hasEventsToDisplay && hasEventsFiltersSelected ? undefined : 'There are no events in the list',
                },
            ]}
            label="Hide properties"
            highlightWhenActive={false}
        />
    )
}

function SyncScrolling(): JSX.Element {
    const { logicProps } = useValues(sessionRecordingPlayerLogic)
    const inspectorLogic = playerInspectorLogic(logicProps)

    const { syncScrollPaused } = useValues(inspectorLogic)
    const { setSyncScrollPaused } = useActions(inspectorLogic)

    return (
        <SettingsToggle
            title={
                syncScrollPaused
                    ? 'Scroll the activity list in sync with playback'
                    : 'Do not auto-scroll the activity list in sync with playback'
            }
            label="Sync scrolling"
            onClick={() => {
                setSyncScrollPaused(!syncScrollPaused)
            }}
            active={!syncScrollPaused}
        />
    )
}

function ShowOnlyMatching(): JSX.Element {
    const { logicProps } = useValues(sessionRecordingPlayerLogic)
    const inspectorLogic = playerInspectorLogic(logicProps)

    const { allItemsByItemType, allowMatchingEventsFilter } = useValues(inspectorLogic)

    const { showOnlyMatching, miniFiltersForType } = useValues(miniFiltersLogic)
    const { setShowOnlyMatching } = useActions(miniFiltersLogic)

    const hasEventsFiltersSelected = miniFiltersForType('events').some((x) => x.enabled)
    const hasEventsToDisplay = allItemsByItemType['events']?.length > 0

    return (
        <SettingsToggle
            title={
                showOnlyMatching
                    ? 'Show all events for this recording'
                    : 'Show only events that match the current filters'
            }
            label="Show only matching events"
            active={hasEventsToDisplay && showOnlyMatching && allowMatchingEventsFilter}
            onClick={() => {
                setShowOnlyMatching(!showOnlyMatching)
            }}
            disabledReason={
                hasEventsToDisplay && hasEventsFiltersSelected
                    ? allowMatchingEventsFilter
                        ? undefined
                        : 'There are no event filters to match against'
                    : 'There are no events in the list'
            }
        />
    )
}

function GroupRepeatedItems(): JSX.Element {
    const { groupRepeatedItems } = useValues(miniFiltersLogic)
    const { setGroupRepeatedItems } = useActions(miniFiltersLogic)

    return (
        <SettingsToggle
            title={
                groupRepeatedItems
                    ? 'Stop grouping repeated items'
                    : 'Group repeated events and console logs into a single row'
            }
            label="Group similar"
            onClick={() => setGroupRepeatedItems(!groupRepeatedItems)}
            active={groupRepeatedItems}
        />
    )
}

function ShowLineTooltips(): JSX.Element {
    const { showLineTooltips } = useValues(miniFiltersLogic)
    const { setShowLineTooltips } = useActions(miniFiltersLogic)

    return (
        <SettingsToggle
            title={showLineTooltips ? 'Hide hover tooltips on inspector lines' : 'Show the full line content on hover'}
            label="Show line tooltips"
            onClick={() => setShowLineTooltips(!showLineTooltips)}
            active={showLineTooltips}
        />
    )
}

export function PlayerInspectorBottomSettings(): JSX.Element {
    const { logicProps } = useValues(sessionRecordingPlayerLogic)
    const { collapseInspectorItems } = useValues(playerInspectorLogic(logicProps))

    return (
        <div className="flex min-w-0 shrink-0">
            <LemonButton
                data-attr="player-inspector-scroll-settings-left"
                icon={<IconChevronLeft />}
                size="xsmall"
                tooltip="Scroll inspector settings left"
                onClick={(event) => scrollInspectorToolbar(event, -1)}
                className="hidden shrink-0 rounded-none border-t @max-[28rem]/replay-sidebar:flex"
            />
            <ScrollableShadows
                direction="horizontal"
                styledScrollbars
                className="!h-auto min-w-0"
                contentClassName="min-w-max"
            >
                <SettingsBar border="top" className="w-max min-w-full !overflow-visible">
                    <SyncScrolling />
                    <ShowOnlyMatching />
                    {collapseInspectorItems ? <GroupRepeatedItems /> : null}
                    <ShowLineTooltips />
                    <HideProperties />
                </SettingsBar>
            </ScrollableShadows>
            <LemonButton
                data-attr="player-inspector-scroll-settings-right"
                icon={<IconChevronRight />}
                size="xsmall"
                tooltip="Scroll inspector settings right"
                onClick={(event) => scrollInspectorToolbar(event, 1)}
                className="hidden shrink-0 rounded-none border-t @max-[28rem]/replay-sidebar:flex"
            />
        </div>
    )
}
