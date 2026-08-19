import { useActions, useValues } from 'kea'
import { Field, Form } from 'kea-forms'

import { LemonButton } from 'lib/lemon-ui/LemonButton'
import { LemonInput } from 'lib/lemon-ui/LemonInput'
import { LemonModal } from 'lib/lemon-ui/LemonModal'
import { LemonTextArea } from 'lib/lemon-ui/LemonTextArea'

import { DashboardType, QueryBasedInsightModel } from '~/types'

import { sectionHeaderModalLogic } from './sectionHeaderModalLogic'

export interface SectionHeaderModalProps {
    isOpen: boolean
    onClose: () => void
    dashboard: DashboardType<QueryBasedInsightModel>
    textTileId: number | 'new' | null
}

export function SectionHeaderModal({ isOpen, onClose, dashboard, textTileId }: SectionHeaderModalProps): JSX.Element {
    const resolvedTileId = textTileId ?? 'new'
    const logicProps = { dashboard, textTileId: resolvedTileId, onClose }
    const logic = sectionHeaderModalLogic(logicProps)
    const { isSectionHeaderSubmitting, sectionHeaderValidationErrors } = useValues(logic)
    const { resetSectionHeader } = useActions(logic)

    const handleClose = (): void => {
        resetSectionHeader()
        onClose()
    }

    const firstError = sectionHeaderValidationErrors.title || sectionHeaderValidationErrors.description

    return (
        <LemonModal
            isOpen={isOpen}
            title={resolvedTileId === 'new' ? 'Add section header' : 'Edit section header'}
            onClose={handleClose}
            width={480}
            footer={
                <>
                    <LemonButton
                        disabledReason={isSectionHeaderSubmitting ? 'Cannot cancel while saving' : null}
                        type="secondary"
                        onClick={handleClose}
                    >
                        Cancel
                    </LemonButton>
                    <LemonButton
                        disabledReason={firstError as string | null}
                        loading={isSectionHeaderSubmitting}
                        form="section-header-form"
                        htmlType="submit"
                        type="primary"
                        data-attr={resolvedTileId === 'new' ? 'save-new-section-header' : 'edit-section-header'}
                    >
                        Save
                    </LemonButton>
                </>
            }
        >
            <Form
                logic={sectionHeaderModalLogic}
                props={logicProps}
                formKey="sectionHeader"
                id="section-header-form"
                enableFormOnSubmit
            >
                <div className="flex flex-col gap-4">
                    <Field name="title" label="Title">
                        <LemonInput placeholder="Acquisition" autoFocus data-attr="section-header-title" />
                    </Field>
                    <Field name="description" label="Description (optional)">
                        <LemonTextArea
                            placeholder="Explain what this section covers"
                            minRows={2}
                            maxRows={4}
                            data-attr="section-header-description"
                        />
                    </Field>
                </div>
            </Form>
        </LemonModal>
    )
}
