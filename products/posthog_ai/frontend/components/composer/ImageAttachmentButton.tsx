import { useRef } from 'react'

import { IconImage } from '@posthog/icons'
import { LemonButton } from '@posthog/lemon-ui'

import { ASSISTANT_ATTACHMENT_ACCEPT } from '../../logics/assistantAttachmentsLogic'

export interface ImageAttachmentButtonProps {
    disabled?: boolean
    onFilesSelected: (files: File[]) => void
}

export function ImageAttachmentButton({ disabled, onFilesSelected }: ImageAttachmentButtonProps): JSX.Element {
    const fileInputRef = useRef<HTMLInputElement | null>(null)

    return (
        <>
            <input
                accept={ASSISTANT_ATTACHMENT_ACCEPT}
                aria-label="Choose PNG or JPEG images"
                className="hidden"
                multiple
                onChange={(event) => {
                    const files = Array.from(event.target.files || [])
                    if (files.length > 0) {
                        onFilesSelected(files)
                    }
                    event.target.value = ''
                }}
                ref={fileInputRef}
                type="file"
            />
            <LemonButton
                aria-label="Add image"
                data-attr="posthog-ai-add-image"
                disabled={disabled}
                icon={<IconImage />}
                noPadding
                onClick={() => fileInputRef.current?.click()}
                size="small"
                type="tertiary"
            />
        </>
    )
}
