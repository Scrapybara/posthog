import { useActions, useValues } from 'kea'
import { Field, Form } from 'kea-forms'

import { sectionHeaderModalLogic } from 'lib/components/Cards/SectionHeader/sectionHeaderModalLogic'
import { LemonButton } from 'lib/lemon-ui/LemonButton'
import { LemonInput } from 'lib/lemon-ui/LemonInput'
import { LemonModal } from 'lib/lemon-ui/LemonModal'
import { LemonTextArea } from 'lib/lemon-ui/LemonTextArea/LemonTextArea'

import { DashboardType, QueryBasedInsightModel } from '~/types'

export function SectionHeaderModal({
    isOpen,
    onClose,
    dashboard,
    sectionHeaderId,
}: {
    isOpen: boolean
    onClose: () => void
    dashboard: DashboardType<QueryBasedInsightModel>
    sectionHeaderId: number | 'new' | null
}): JSX.Element {
    const resolvedId = sectionHeaderId ?? 'new'
    const modalLogicProps = { dashboard, sectionHeaderId: resolvedId, onClose }
    const modalLogic = sectionHeaderModalLogic(modalLogicProps)
    const { isSectionHeaderSubmitting, sectionHeaderValidationErrors } = useValues(modalLogic)
    const { resetSectionHeader } = useActions(modalLogic)

    const handleClose = (): void => {
        resetSectionHeader()
        onClose()
    }

    return (
        <LemonModal
            closable={true}
            isOpen={isOpen}
            title={resolvedId === 'new' ? 'Add section header' : 'Edit section header'}
            description="A full-width heading to group tiles into labeled sections."
            onClose={handleClose}
            footer={
                <>
                    <LemonButton
                        disabledReason={isSectionHeaderSubmitting ? 'Cannot cancel in progress' : null}
                        type="secondary"
                        onClick={handleClose}
                    >
                        Cancel
                    </LemonButton>
                    <LemonButton
                        disabledReason={sectionHeaderValidationErrors.title as string | null}
                        loading={isSectionHeaderSubmitting}
                        form="section-header-form"
                        htmlType="submit"
                        type="primary"
                        data-attr={resolvedId === 'new' ? 'save-new-section-header' : 'edit-section-header'}
                    >
                        Save
                    </LemonButton>
                </>
            }
        >
            <Form
                logic={sectionHeaderModalLogic}
                props={modalLogicProps}
                formKey="sectionHeader"
                id="section-header-form"
                enableFormOnSubmit
            >
                <div className="flex flex-col gap-4 w-full max-w-md">
                    <Field name="title" label="Title">
                        <LemonInput placeholder="e.g. Acquisition" data-attr="section-header-title" autoFocus />
                    </Field>
                    <Field name="description" label="Description">
                        <LemonTextArea
                            placeholder="Optional — e.g. How new users discover and sign up for the product"
                            data-attr="section-header-description"
                            minRows={1}
                            maxRows={3}
                        />
                    </Field>
                </div>
            </Form>
        </LemonModal>
    )
}
