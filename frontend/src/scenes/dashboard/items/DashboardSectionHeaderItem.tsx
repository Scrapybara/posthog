import clsx from 'clsx'
import { useValues } from 'kea'
import React from 'react'

import { Resizeable } from 'lib/components/Cards/CardMeta'
import { DashboardResizeHandles } from 'lib/components/Cards/handles'
import { dashboardWidgetMenusLogic } from 'lib/components/Cards/InsightCard/dashboardWidgetMenusLogic'
import { DashboardWidgetPlacementMenus } from 'lib/components/Cards/InsightCard/DashboardWidgetPlacementMenus'
import { EditModeEdge, EditModeEdgeOverlay } from 'lib/components/Cards/InsightCard/EditModeEdgeOverlay'
import { DashboardSectionHeader } from 'lib/components/Cards/TextCard/sectionHeader'
import { LemonButton } from 'lib/lemon-ui/LemonButton'
import { More } from 'lib/lemon-ui/LemonButton/More'
import { LemonDivider } from 'lib/lemon-ui/LemonDivider'

import { DashboardPlacement, DashboardTile, DashboardType, QueryBasedInsightModel } from '~/types'

export interface DashboardSectionHeaderItemProps extends React.HTMLAttributes<HTMLDivElement>, Resizeable {
    tile: DashboardTile<QueryBasedInsightModel>
    sectionHeader: DashboardSectionHeader
    placement: DashboardPlacement
    dashboardId?: number | null
    onEdit: () => void
    onMoveToDashboard?: (target: Pick<DashboardType, 'id' | 'name'>) => void
    onCopyToDashboard?: (target: Pick<DashboardType, 'id' | 'name'>) => void
    onDuplicate: () => void
    onRemove?: () => void
    canEnterEditModeFromEdge?: boolean
    onEnterEditModeFromEdge?: (event: React.MouseEvent<HTMLDivElement>, edge: EditModeEdge) => void
    onDragHandleMouseDown?: React.MouseEventHandler<HTMLDivElement>
    showEditingControls?: boolean
}

function DashboardSectionHeaderItemInternal(
    {
        tile,
        sectionHeader,
        placement,
        dashboardId,
        onEdit,
        onMoveToDashboard,
        onCopyToDashboard,
        onDuplicate,
        onRemove,
        showResizeHandles,
        canEnterEditModeFromEdge,
        onEnterEditModeFromEdge,
        onDragHandleMouseDown,
        showEditingControls,
        className,
        ...divProps
    }: DashboardSectionHeaderItemProps,
    ref: React.ForwardedRef<HTMLDivElement>
): JSX.Element {
    const textId = tile.text?.id
    const { copyToDestinations } = useValues(
        dashboardWidgetMenusLogic({
            instanceKey: textId != null ? `section-header-${textId}` : `section-header-tile-${tile.id}`,
            dashboardId,
            dashboards: undefined,
            dashboard_tiles: tile.text?.dashboard_tiles,
        })
    )
    const shouldHideMoreButton = placement === DashboardPlacement.Public || showEditingControls === false

    return (
        <div
            className={clsx(
                'DashboardTileCard relative flex flex-col border-b border-border',
                showResizeHandles && 'rounded border border-dashed border-border',
                className
            )}
            data-attr="dashboard-section-header"
            {...divProps}
            ref={ref}
        >
            {!shouldHideMoreButton && (
                <div className="absolute right-4 top-3">
                    <More
                        overlay={
                            <>
                                <LemonButton fullWidth onClick={onEdit} data-attr="edit-section-header">
                                    Edit section header
                                </LemonButton>
                                <DashboardWidgetPlacementMenus
                                    placementDestinations={copyToDestinations}
                                    onMoveToDashboard={onMoveToDashboard}
                                    onCopyToDashboard={onCopyToDashboard}
                                />
                                <LemonButton fullWidth onClick={onDuplicate} data-attr="duplicate-section-header">
                                    Duplicate
                                </LemonButton>
                                <LemonDivider />
                                {onRemove && (
                                    <LemonButton
                                        status="danger"
                                        fullWidth
                                        onClick={onRemove}
                                        data-attr="remove-section-header"
                                    >
                                        Delete
                                    </LemonButton>
                                )}
                            </>
                        }
                    />
                </div>
            )}
            <div
                className={clsx(
                    'drag-handle flex h-full flex-col justify-center px-4 py-2 pr-14',
                    onDragHandleMouseDown && 'cursor-grab'
                )}
                onMouseDown={onDragHandleMouseDown}
            >
                <h2 className="truncate text-lg font-semibold leading-tight">{sectionHeader.title}</h2>
                {sectionHeader.description && (
                    <p className="mt-1 line-clamp-2 text-sm leading-tight text-secondary">
                        {sectionHeader.description}
                    </p>
                )}
            </div>
            {canEnterEditModeFromEdge && !showResizeHandles && onEnterEditModeFromEdge && (
                <EditModeEdgeOverlay onEnterEditMode={onEnterEditModeFromEdge} />
            )}
            {showResizeHandles && <DashboardResizeHandles />}
        </div>
    )
}

export const DashboardSectionHeaderItem = React.forwardRef<HTMLDivElement, DashboardSectionHeaderItemProps>(
    DashboardSectionHeaderItemInternal
)
