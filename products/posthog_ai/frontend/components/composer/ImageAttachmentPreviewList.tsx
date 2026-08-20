import { IconImage, IconRefresh, IconTrash } from '@posthog/icons'
import { LemonButton, Spinner } from '@posthog/lemon-ui'

import type { AssistantAttachment } from '../../logics/assistantAttachmentsLogic'

export interface ImageAttachmentPreviewListProps {
    attachments: AssistantAttachment[]
    disabled?: boolean
    onRemove: (localId: string) => void
    onRetry: (localId: string) => void
}

export function ImageAttachmentPreviewList({
    attachments,
    disabled = false,
    onRemove,
    onRetry,
}: ImageAttachmentPreviewListProps): JSX.Element | null {
    if (attachments.length === 0) {
        return null
    }

    return (
        <div className="flex flex-wrap gap-2 px-2 pt-2 pb-1" data-attr="posthog-ai-attachment-list">
            {attachments.map((attachment) => (
                <div
                    key={attachment.localId}
                    className="flex w-44 max-w-full items-center gap-2 rounded-md border border-primary bg-bg-light p-2"
                >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-fill-secondary">
                        {attachment.previewUrl ? (
                            <img
                                alt={attachment.file.name}
                                className="h-full w-full object-cover"
                                src={attachment.previewUrl}
                            />
                        ) : (
                            <IconImage className="text-lg text-secondary" />
                        )}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium" title={attachment.file.name}>
                            {attachment.file.name}
                        </div>
                        {attachment.status === 'uploading' ? (
                            <span className="flex items-center gap-1 text-xs text-secondary">
                                <Spinner textColored /> Uploading
                            </span>
                        ) : attachment.status === 'error' ? (
                            <span className="text-xs text-danger">{attachment.error || 'Upload failed'}</span>
                        ) : (
                            <span className="text-xs text-success">Ready</span>
                        )}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                        {attachment.status === 'error' && (
                            <LemonButton
                                aria-label={`Retry ${attachment.file.name}`}
                                data-attr="posthog-ai-attachment-retry"
                                disabled={disabled}
                                icon={<IconRefresh />}
                                noPadding
                                onClick={() => onRetry(attachment.localId)}
                                size="xsmall"
                                type="tertiary"
                            />
                        )}
                        <LemonButton
                            aria-label={`Remove ${attachment.file.name}`}
                            data-attr="posthog-ai-attachment-remove"
                            disabled={disabled}
                            icon={<IconTrash />}
                            noPadding
                            onClick={() => onRemove(attachment.localId)}
                            size="xsmall"
                            type="tertiary"
                        />
                    </div>
                </div>
            ))}
        </div>
    )
}
