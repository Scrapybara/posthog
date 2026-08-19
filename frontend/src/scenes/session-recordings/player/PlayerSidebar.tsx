import clsx from 'clsx'
import { useActions, useValues } from 'kea'
import { useRef } from 'react'

import { IconBottomPanel, IconChevronDown, IconSidePanel, IconX } from '@posthog/icons'
import { LemonButton, LemonMenu, LemonTabs } from '@posthog/lemon-ui'

import { Resizer } from 'lib/components/Resizer/Resizer'
import { ResizerLogicProps, resizerLogic } from 'lib/components/Resizer/resizerLogic'
import { ScrollableShadows } from 'lib/components/ScrollableShadows/ScrollableShadows'
import { FEATURE_FLAGS } from 'lib/constants'
import { integrationsLogic } from 'lib/integrations/integrationsLogic'
import { featureFlagLogic } from 'lib/logic/featureFlagLogic'
import { capitalizeFirstLetter, splitKebabCase } from 'lib/utils/strings'

import { SessionRecordingSidebarStacking, SessionRecordingSidebarTab } from '~/types'

import { visionSurfaceShown } from 'products/replay_vision/frontend/utils/visionSurface'

import { playerSettingsLogic } from './playerSettingsLogic'
import { sessionRecordingPlayerLogic } from './sessionRecordingPlayerLogic'
import { playerSidebarLogic } from './sidebar/playerSidebarLogic'
import { PlayerSidebarTab } from './sidebar/PlayerSidebarTab'

export function PlayerSidebar(): JSX.Element {
    const ref = useRef<HTMLDivElement>(null)

    const { activeTab } = useValues(playerSidebarLogic)
    const { setTab } = useActions(playerSidebarLogic)
    const { sidebarOpen, preferredSidebarStacking, isVerticallyStacked } = useValues(playerSettingsLogic)
    const { setSidebarOpen, setPreferredSidebarStacking } = useActions(playerSettingsLogic)
    const { getIntegrationsByKind } = useValues(integrationsLogic)
    const { sessionPlayerMetaData, logicProps } = useValues(sessionRecordingPlayerLogic)
    const { featureFlags } = useValues(featureFlagLogic)

    const logicKey = `player-sidebar-${isVerticallyStacked ? 'vertical' : 'horizontal'}`

    const resizerLogicProps: ResizerLogicProps = {
        logicKey,
        containerRef: ref,
        persistent: true,
        persistPrefix: '2025-12-29',
        closeThreshold: 100,
        placement: isVerticallyStacked ? 'top' : 'left',
        onToggleClosed: (shouldBeClosed) => setSidebarOpen(!shouldBeClosed),
    }

    const { desiredSize } = useValues(resizerLogic(resizerLogicProps))

    const sidebarTabs = [
        SessionRecordingSidebarTab.OVERVIEW,
        SessionRecordingSidebarTab.INSPECTOR,
        SessionRecordingSidebarTab.NETWORK_WATERFALL,
    ]

    if (visionSurfaceShown(logicProps)) {
        sidebarTabs.push(SessionRecordingSidebarTab.OBSERVATIONS)
    }

    // Show the person's other recordings once we know who they are
    if (featureFlags[FEATURE_FLAGS.REPLAY_PLAYER_PERSON_SESSIONS_TAB] && sessionPlayerMetaData?.person) {
        sidebarTabs.push(SessionRecordingSidebarTab.SESSIONS)
    }

    // Show linked issues tab if there are integrations or existing references
    const sessionReplayIntegrations = getIntegrationsByKind(['linear', 'github', 'gitlab', 'jira'])
    const externalReferences = sessionPlayerMetaData?.external_references ?? []

    if (sessionReplayIntegrations.length > 0 || externalReferences.length > 0) {
        sidebarTabs.push(SessionRecordingSidebarTab.LINKED_ISSUES)
    }

    return (
        <div
            className={clsx(
                'SessionRecordingPlayer__sidebar',
                !sidebarOpen && 'SessionRecordingPlayer__sidebar--collapsed'
            )}
            ref={ref}
            // eslint-disable-next-line react/forbid-dom-props
            style={
                !sidebarOpen
                    ? {}
                    : isVerticallyStacked
                      ? { height: desiredSize ?? undefined, minHeight: 210 }
                      : { width: desiredSize ?? undefined }
            }
        >
            <Resizer
                logicKey={logicKey}
                placement={sidebarOpen && isVerticallyStacked ? 'top' : 'left'}
                containerRef={ref}
                closeThreshold={100}
                offset="0.25rem"
            />
            {sidebarOpen && (
                <div className="SessionRecordingPlayer__sidebar__content @container/replay-sidebar">
                    <div className="flex bg-surface-primary pt-[1px]">
                        <div className="hidden min-w-0 flex-1 @min-[47rem]/replay-sidebar:flex">
                            <div className="w-2.5 border-b shrink-0" />
                            <ScrollableShadows
                                direction="horizontal"
                                styledScrollbars
                                className="!h-auto min-w-0 flex-1"
                                contentClassName="min-w-max"
                            >
                                <LemonTabs
                                    activeKey={activeTab}
                                    onChange={(tabId) => setTab(tabId)}
                                    tabs={sidebarTabs.map((tabId) => ({
                                        key: tabId,
                                        label: capitalizeFirstLetter(splitKebabCase(tabId)),
                                    }))}
                                    barClassName="!mb-0 !overflow-x-visible"
                                    size="small"
                                    className="min-w-full w-max"
                                />
                            </ScrollableShadows>
                        </div>
                        <div className="flex min-w-0 flex-1 items-center border-b p-1 @min-[47rem]/replay-sidebar:hidden">
                            <LemonMenu
                                items={sidebarTabs.map((tabId) => ({
                                    label: capitalizeFirstLetter(splitKebabCase(tabId)),
                                    active: tabId === activeTab,
                                    onClick: () => setTab(tabId),
                                }))}
                            >
                                <LemonButton
                                    data-attr="player-sidebar-navigation-menu"
                                    fullWidth
                                    size="small"
                                    sideIcon={<IconChevronDown />}
                                    className="min-w-0"
                                >
                                    {capitalizeFirstLetter(splitKebabCase(activeTab))}
                                </LemonButton>
                            </LemonMenu>
                        </div>
                        <div className="flex gap-1 border-b end">
                            <LemonButton
                                size="small"
                                icon={isVerticallyStacked ? <IconSidePanel /> : <IconBottomPanel />}
                                onClick={() =>
                                    setPreferredSidebarStacking(
                                        preferredSidebarStacking === SessionRecordingSidebarStacking.Vertical
                                            ? SessionRecordingSidebarStacking.Horizontal
                                            : SessionRecordingSidebarStacking.Vertical
                                    )
                                }
                                tooltip={`Dock to ${isVerticallyStacked ? 'right' : 'bottom'}`}
                            />
                            <LemonButton
                                size="small"
                                icon={<IconX />}
                                onClick={() => setSidebarOpen(false)}
                                tooltip="Close sidebar"
                            />
                        </div>
                    </div>
                    <PlayerSidebarTab />
                </div>
            )}
        </div>
    )
}
