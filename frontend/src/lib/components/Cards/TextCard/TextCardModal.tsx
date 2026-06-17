import { useActions, useValues } from 'kea'
import { Field, Form } from 'kea-forms'
import { useCallback, useMemo } from 'react'

import { isTextCardMarkdownRoundTripSafe } from 'lib/components/Cards/TextCard/textCardMarkdown'
import { TextCardModalBodyField } from 'lib/components/Cards/TextCard/TextCardModalBodyField'
import { TextCardModalKind, textCardModalLogic } from 'lib/components/Cards/TextCard/textCardModalLogic'
import { parseDashboardSectionHeaderBody } from 'lib/components/Cards/TextCard/textCardSectionHeader'
import { LemonButton } from 'lib/lemon-ui/LemonButton'
import { LemonInput } from 'lib/lemon-ui/LemonInput'
import { LemonSwitch } from 'lib/lemon-ui/LemonSwitch'
import { LemonTextArea } from 'lib/lemon-ui/LemonTextArea'
import { DialogClose, DialogPrimitive, DialogPrimitiveTitle } from 'lib/ui/DialogPrimitive/DialogPrimitive'
import { cn } from 'lib/utils/css-classes'

import { DashboardType, QueryBasedInsightModel } from '~/types'

export function TextCardModal({
    isOpen,
    onClose,
    dashboard,
    textTileId,
    kind = 'text',
    smLayouts,
}: {
    isOpen: boolean
    onClose: () => void
    dashboard: DashboardType<QueryBasedInsightModel>
    textTileId: number | 'new' | null
    kind?: TextCardModalKind
    smLayouts?: ReadonlyArray<{ y?: number; h?: number }>
}): JSX.Element {
    const resolvedTileId = textTileId ?? 'new'
    const modalLogicProps = { dashboard, textTileId: resolvedTileId, onClose, kind, smLayouts }
    const modalLogic = textCardModalLogic(modalLogicProps)
    // Form `body` + validation drive updates while typing; splitting useValues does not reduce rerenders.
    const { isTextTileSubmitting, textTileValidationErrors, textTile } = useValues(modalLogic)
    const { resetTextTile } = useActions(modalLogic)
    const initialForm = useMemo(() => {
        const body =
            resolvedTileId !== 'new'
                ? dashboard.tiles?.find((tile) => tile.id === resolvedTileId)?.text?.body || ''
                : ''
        const sectionHeader = parseDashboardSectionHeaderBody(body)
        return {
            body,
            title: sectionHeader?.title || '',
            description: sectionHeader?.description || '',
        }
    }, [dashboard.tiles, resolvedTileId])
    const isSectionHeader = kind === 'section'
    const initialBody = initialForm.body
    const shouldUseLegacyMarkdownEditor = !isTextCardMarkdownRoundTripSafe(initialBody)
    const hasUnsavedInput = isSectionHeader
        ? (textTile?.title || '') !== initialForm.title || (textTile?.description || '') !== initialForm.description
        : (textTile?.body || '') !== initialBody

    const handleClose = useCallback((): void => {
        resetTextTile()
        onClose()
    }, [onClose, resetTextTile])

    const modalTitle =
        resolvedTileId === 'new'
            ? isSectionHeader
                ? 'Add section header'
                : 'Add text card'
            : isSectionHeader
              ? 'Edit section header'
              : 'Edit text card'
    const disabledReason = isSectionHeader
        ? ((textTileValidationErrors.title || textTileValidationErrors.description) as string | null)
        : (textTileValidationErrors.body as string | null)

    return (
        <DialogPrimitive
            open={isOpen}
            onOpenChange={(open) => !open && handleClose()}
            disablePointerDismissal={hasUnsavedInput}
            className={cn(
                isSectionHeader
                    ? 'w-[min(100vw-3rem,38rem)] max-h-[calc(100vh-4rem)] top-16'
                    : 'w-[min(100vw-3rem,72rem)] min-w-full lg:min-w-6xl max-h-[calc(100vh-4rem)] top-8',
                'bg-surface-primary',
                // DialogPrimitive defaults to z above --z-popover; rich editor toolbars portal to body at
                // --z-popover and would sit under the panel. Sit the dialog just below that layer instead.
                'z-[calc(var(--z-popover)-1)]'
            )}
        >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-primary py-2 pl-4 pr-2">
                <DialogPrimitiveTitle className="min-w-0 flex-1 text-base font-semibold">
                    {modalTitle}
                </DialogPrimitiveTitle>
                <DialogClose className="shrink-0" />
            </div>
            <div
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
                data-attr={isSectionHeader ? 'section-header-modal' : 'text-card-modal'}
            >
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                    <Form
                        logic={textCardModalLogic}
                        props={modalLogicProps}
                        formKey="textTile"
                        id="text-tile-form"
                        enableFormOnSubmit
                    >
                        <div className="flex flex-col gap-4">
                            {isSectionHeader ? (
                                <>
                                    <Field name="title" label="Title">
                                        {({ value, onChange }) => (
                                            <LemonInput
                                                value={value}
                                                onChange={onChange}
                                                maxLength={120}
                                                placeholder="Activation funnel"
                                                data-attr="section-header-title"
                                                autoFocus
                                            />
                                        )}
                                    </Field>
                                    <Field name="description" label="Description (optional)">
                                        {({ value, onChange }) => (
                                            <LemonTextArea
                                                value={value}
                                                onChange={onChange}
                                                maxLength={240}
                                                minRows={2}
                                                maxRows={4}
                                                placeholder="A short note about this dashboard section"
                                                data-attr="section-header-description"
                                            />
                                        )}
                                    </Field>
                                </>
                            ) : (
                                <>
                                    <Field name="body" label="">
                                        {({ value, onChange }) => (
                                            <TextCardModalBodyField
                                                shouldUseLegacyMarkdownEditor={shouldUseLegacyMarkdownEditor}
                                                value={value}
                                                onChange={onChange}
                                            />
                                        )}
                                    </Field>
                                    <Field name="transparent_background" label="">
                                        {({ value, onChange }) => (
                                            <LemonSwitch
                                                checked={value}
                                                onChange={onChange}
                                                label="Transparent background"
                                                data-attr="text-card-transparent-background"
                                            />
                                        )}
                                    </Field>
                                </>
                            )}
                        </div>
                    </Form>
                </div>
                <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-primary p-4">
                    <LemonButton
                        disabledReason={isTextTileSubmitting ? 'Cannot cancel card creation in progress' : null}
                        type="secondary"
                        onClick={handleClose}
                    >
                        Cancel
                    </LemonButton>
                    <LemonButton
                        disabledReason={disabledReason}
                        loading={isTextTileSubmitting}
                        form="text-tile-form"
                        htmlType="submit"
                        type="primary"
                        data-attr={
                            isSectionHeader
                                ? resolvedTileId === 'new'
                                    ? 'save-new-section-header'
                                    : 'edit-section-header'
                                : resolvedTileId === 'new'
                                  ? 'save-new-text-tile'
                                  : 'edit-text-tile-text'
                        }
                    >
                        Save
                    </LemonButton>
                </footer>
            </div>
        </DialogPrimitive>
    )
}
