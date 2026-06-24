import '@testing-library/jest-dom'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BindLogic, Provider } from 'kea'

import api from 'lib/api'

import { useMocks } from '~/mocks/jest'
import { initKeaTests } from '~/test/init'

import { maxGlobalLogic } from '../maxGlobalLogic'
import { maxLogic } from '../maxLogic'
import { maxThreadLogic } from '../maxThreadLogic'
import { maxMocks } from '../testUtils'
import { QuestionInput } from './QuestionInput'

jest.mock(
    '@posthog/hogvm',
    () => ({
        exec: jest.fn(),
        execAsync: jest.fn(),
    }),
    { virtual: true }
)

describe('QuestionInput slash command autocomplete', () => {
    let maxLogicInstance: ReturnType<typeof maxLogic.build>
    let threadLogicInstance: ReturnType<typeof maxThreadLogic.build>

    beforeEach(() => {
        Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: jest.fn(() => 'blob:preview') })
        Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() })
        useMocks(maxMocks)
        initKeaTests()

        const maxGlobalLogicInstance = maxGlobalLogic()
        maxGlobalLogicInstance.mount()
        jest.spyOn(maxGlobalLogicInstance.selectors, 'dataProcessingAccepted').mockReturnValue(true)

        maxLogicInstance = maxLogic({ panelId: 'test' })
        maxLogicInstance.mount()

        const threadProps = { panelId: 'test', conversationId: maxLogicInstance.values.frontendConversationId }
        threadLogicInstance = maxThreadLogic(threadProps)
        threadLogicInstance.mount()

        render(
            <Provider>
                <BindLogic logic={maxLogic} props={{ panelId: 'test' }}>
                    <BindLogic logic={maxThreadLogic} props={threadProps}>
                        <QuestionInput />
                    </BindLogic>
                </BindLogic>
            </Provider>
        )
    })

    afterEach(() => {
        cleanup()
        threadLogicInstance?.unmount()
        maxLogicInstance?.cache.eventSourceController?.abort()
        maxLogicInstance?.unmount()
        jest.restoreAllMocks()
    })

    const slashCommandItem = (): HTMLElement | null => screen.queryByText('/init')

    it('reopens the popover after Escape dismisses it and a fresh slash is typed', async () => {
        const input = screen.getByRole('textbox') as HTMLTextAreaElement

        fireEvent.change(input, { target: { value: '/' } })
        await waitFor(() => expect(slashCommandItem()).toBeInTheDocument())

        fireEvent.keyDown(document, { key: 'Escape' })
        await waitFor(() => expect(slashCommandItem()).not.toBeInTheDocument())

        fireEvent.change(input, { target: { value: '' } })
        await waitFor(() => expect(input.value).toBe(''))

        fireEvent.change(input, { target: { value: '/' } })
        await waitFor(() => expect(slashCommandItem()).toBeInTheDocument())
    })

    it.each([
        [
            'picker',
            (_input: HTMLTextAreaElement, fileInput: HTMLInputElement, file: File) =>
                fireEvent.change(fileInput, { target: { files: [file] } }),
        ],
        [
            'drop',
            (input: HTMLTextAreaElement, _fileInput: HTMLInputElement, file: File) =>
                fireEvent.drop(input.closest('label')!, {
                    dataTransfer: { files: [file], types: ['Files'] },
                }),
        ],
        [
            'paste',
            (input: HTMLTextAreaElement, _fileInput: HTMLInputElement, file: File) =>
                fireEvent.paste(input, {
                    clipboardData: {
                        items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
                    },
                }),
        ],
    ])('uploads and previews an image from %s', async (_source, addFile) => {
        jest.spyOn(api.conversations.attachments, 'upload').mockResolvedValue({
            id: 'attachment-id',
            file_name: 'chart.png',
            content_type: 'image/png',
            size: 3,
            width: 1,
            height: 1,
        })
        const input = screen.getByRole('textbox') as HTMLTextAreaElement
        const fileInput = screen.getByLabelText('Choose PNG or JPEG images') as HTMLInputElement
        addFile(input, fileInput, new File(['png'], 'chart.png', { type: 'image/png' }))

        await waitFor(() => expect(screen.getByAltText('chart.png')).toBeInTheDocument())
        expect(threadLogicInstance.values.pendingAttachments[0]?.attachment?.id).toBe('attachment-id')
    })

    it('removes an uploaded image and revokes its preview URL', async () => {
        jest.spyOn(api.conversations.attachments, 'upload').mockResolvedValue({
            id: 'attachment-id',
            file_name: 'chart.png',
            content_type: 'image/png',
            size: 3,
            width: 1,
            height: 1,
        })
        jest.spyOn(api.conversations.attachments, 'delete').mockResolvedValue()
        const fileInput = screen.getByLabelText('Choose PNG or JPEG images')
        fireEvent.change(fileInput, {
            target: { files: [new File(['png'], 'chart.png', { type: 'image/png' })] },
        })
        await waitFor(() => expect(screen.getByAltText('chart.png')).toBeInTheDocument())

        fireEvent.click(screen.getByLabelText('Remove chart.png'))
        await waitFor(() => expect(screen.queryByAltText('chart.png')).not.toBeInTheDocument())
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
        expect(api.conversations.attachments.delete).toHaveBeenCalledWith(
            maxLogicInstance.values.frontendConversationId,
            'attachment-id'
        )
    })

    it('limits attachments to four files', async () => {
        jest.spyOn(api.conversations.attachments, 'upload').mockImplementation(async (_conversationId, file) => ({
            id: file.name,
            file_name: file.name,
            content_type: 'image/png',
            size: file.size,
            width: 1,
            height: 1,
        }))
        const files = Array.from(
            { length: 5 },
            (_, index) => new File(['png'], `chart-${index}.png`, { type: 'image/png' })
        )
        fireEvent.change(screen.getByLabelText('Choose PNG or JPEG images'), { target: { files } })

        await waitFor(() => expect(threadLogicInstance.values.pendingAttachments).toHaveLength(4))
        expect(screen.getByRole('alert')).toHaveTextContent('up to 4 images')
    })

    it('rejects unsupported files and guards image-only submit while uploading', async () => {
        let finishUpload: ((value: any) => void) | undefined
        jest.spyOn(api.conversations.attachments, 'upload').mockImplementation(
            () => new Promise((resolve) => (finishUpload = resolve))
        )
        const fileInput = screen.getByLabelText('Choose PNG or JPEG images')
        fireEvent.change(fileInput, {
            target: { files: [new File(['svg'], 'image.svg', { type: 'image/svg+xml' })] },
        })
        expect(await screen.findByRole('alert')).toHaveTextContent('Only PNG and JPEG')

        fireEvent.change(fileInput, {
            target: {
                files: [new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })],
            },
        })
        expect(await screen.findByRole('alert')).toHaveTextContent('4 MiB or smaller')

        fireEvent.change(fileInput, {
            target: { files: [new File(['png'], 'chart.png', { type: 'image/png' })] },
        })
        await waitFor(() => expect(threadLogicInstance.values.submissionDisabledReason).toContain('finish uploading'))

        finishUpload?.({
            id: 'attachment-id',
            file_name: 'chart.png',
            content_type: 'image/png',
            size: 3,
            width: 1,
            height: 1,
        })
        await waitFor(() => expect(threadLogicInstance.values.submissionDisabledReason).toBeUndefined())
        fireEvent.click(document.querySelector('[data-attr="max-send-message"]')!)
        await waitFor(() =>
            expect(threadLogicInstance.values.threadRaw).toEqual([
                expect.objectContaining({
                    type: 'human',
                    content: '',
                    attachments: [expect.objectContaining({ id: 'attachment-id' })],
                }),
            ])
        )
    })
})
