import { BindLogic, useActions, useValues } from 'kea'

import { LemonButton } from 'lib/lemon-ui/LemonButton'
import { LemonDivider } from 'lib/lemon-ui/LemonDivider'
import { LemonField } from 'lib/lemon-ui/LemonField/LemonField'
import { LemonInput } from 'lib/lemon-ui/LemonInput/LemonInput'
import { LemonModal } from 'lib/lemon-ui/LemonModal'

import { getDashboardWidgetGroupLabel } from '../../widget_types/catalog'
import { EditWidgetModalFiltersSubsection } from '../EditWidgetModalFiltersSection'
import { EditWidgetModalTileDetailsSection } from '../EditWidgetModalTileDetailsSection'
import type { DashboardWidgetEditModalProps } from '../registry'
import { editLiveActivityWidgetModalLogic } from './editLiveActivityWidgetModalLogic'

function EditLiveActivityWidgetModalContents(): JSX.Element {
    const {
        limit,
        refreshIntervalSeconds,
        tileName,
        tileDescription,
        filterTestAccounts,
        activeFieldErrors,
        saving,
        saveDisabledReason,
        onClose,
        defaultTitle,
    } = useValues(editLiveActivityWidgetModalLogic)
    const {
        setLimit,
        setRefreshIntervalSeconds,
        setTileName,
        setTileDescription,
        setFilterTestAccounts,
        clearFieldError,
        submit,
    } = useActions(editLiveActivityWidgetModalLogic)

    return (
        <LemonModal
            isOpen
            onClose={onClose}
            title="Widget settings"
            description="Configure tile details and live activity refresh behavior."
            width={680}
            footer={
                <>
                    <div className="flex-1" />
                    <LemonButton type="secondary" onClick={onClose} disabled={saving}>
                        Cancel
                    </LemonButton>
                    <LemonButton
                        type="primary"
                        loading={saving}
                        disabledReason={saveDisabledReason}
                        onClick={() => submit()}
                    >
                        Save
                    </LemonButton>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <EditWidgetModalTileDetailsSection
                    tileName={tileName}
                    tileDescription={tileDescription}
                    defaultTitle={defaultTitle}
                    saving={saving}
                    setTileName={setTileName}
                    setTileDescription={setTileDescription}
                />
                <LemonDivider className="my-0" />
                <section className="flex flex-col gap-3">
                    <h5 className="text-sm font-semibold m-0">{getDashboardWidgetGroupLabel('activity')}</h5>
                    <div className="flex flex-col gap-4">
                        <EditWidgetModalFiltersSubsection
                            title="Live activity"
                            filterTestAccounts={filterTestAccounts}
                            saving={saving}
                            setFilterTestAccounts={setFilterTestAccounts}
                        >
                            <p className="text-sm text-muted m-0 sm:col-span-2">
                                Live activity always uses a fixed 5-minute rolling window. Auto-refresh pauses while the
                                browser tab is hidden.
                            </p>
                            <LemonField.Pure
                                label="Recent events"
                                help="Show up to 10 recent events in the feed."
                                error={activeFieldErrors.limit}
                            >
                                <LemonInput
                                    type="number"
                                    min={1}
                                    max={10}
                                    fullWidth
                                    value={limit}
                                    onChange={(value) => {
                                        setLimit(Number(value))
                                        clearFieldError('limit')
                                    }}
                                />
                            </LemonField.Pure>
                            <LemonField.Pure
                                label="Refresh interval"
                                help="Use 15 to 60 seconds between automatic refreshes."
                                error={activeFieldErrors.refreshIntervalSeconds}
                            >
                                <LemonInput
                                    type="number"
                                    min={15}
                                    max={60}
                                    fullWidth
                                    value={refreshIntervalSeconds}
                                    onChange={(value) => {
                                        setRefreshIntervalSeconds(Number(value))
                                        clearFieldError('refreshIntervalSeconds')
                                    }}
                                />
                            </LemonField.Pure>
                        </EditWidgetModalFiltersSubsection>
                    </div>
                </section>
            </div>
        </LemonModal>
    )
}

export function EditLiveActivityWidgetModal({
    isOpen,
    onClose,
    config,
    onSave,
    name,
    defaultTitle,
    description,
}: DashboardWidgetEditModalProps): JSX.Element | null {
    if (!isOpen) {
        return null
    }

    return (
        <BindLogic
            logic={editLiveActivityWidgetModalLogic}
            props={{ onClose, config, onSave, name, defaultTitle, description }}
        >
            <EditLiveActivityWidgetModalContents />
        </BindLogic>
    )
}
