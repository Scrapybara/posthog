import '@testing-library/jest-dom'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BindLogic, Provider } from 'kea'

import { useMocks } from '~/mocks/jest'
import { initKeaTests } from '~/test/init'

import {
    conversationAttachmentsCreate,
    conversationAttachmentsDestroy,
} from 'products/posthog_ai/frontend/generated/api'

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

jest.mock('products/posthog_ai/frontend/generated/api', () => ({
    conversationAttachmentsCreate: jest.fn(),
    conversationAttachmentsDestroy: jest.fn(),
}))

describe('QuestionInput slash command autocomplete', () => {
    let maxLogicInstance: ReturnType<typeof maxLogic.build>
    let threadLogicInstance: ReturnType<typeof maxThreadLogic.build>
    let container: HTMLElement
    let uploadCounter = 0

    beforeEach(() => {
        uploadCounter = 0
        Object.defineProperty(URL, 'createObjectURL', {
            configurable: true,
            value: jest.fn(() => `blob:preview-${uploadCounter}`),
        })
        Object.defineProperty(URL, 'revokeObjectURL', {
            configurable: true,
            value: jest.fn(),
        })
        ;(conversationAttachmentsCreate as jest.Mock).mockImplementation(async (_projectId: string, body: any) => {
            uploadCounter += 1
            return {
                id: `attachment-${uploadCounter}`,
                filename: body.file.name,
                content_type: body.file.type,
                byte_size: body.file.size,
            }
        })
        ;(conversationAttachmentsDestroy as jest.Mock).mockResolvedValue(undefined)
        useMocks({
            ...maxMocks,
            get: {
                ...maxMocks.get,
                '/api/billing/credits/overview': {
                    eligible: false,
                    estimated_monthly_credit_amount_usd: null,
                    status: 'none',
                    invoice_url: null,
                    collection_method: null,
                    cc_last_four: null,
                    email: null,
                    credit_brackets: [],
                },
            },
        })
        initKeaTests()

        const maxGlobalLogicInstance = maxGlobalLogic()
        maxGlobalLogicInstance.mount()
        jest.spyOn(maxGlobalLogicInstance.selectors, 'dataProcessingAccepted').mockReturnValue(true)

        maxLogicInstance = maxLogic({ panelId: 'test' })
        maxLogicInstance.mount()

        const threadProps = { panelId: 'test', conversationId: maxLogicInstance.values.frontendConversationId }
        threadLogicInstance = maxThreadLogic(threadProps)
        threadLogicInstance.mount()

        container = render(
            <Provider>
                <BindLogic logic={maxLogic} props={{ panelId: 'test' }}>
                    <BindLogic logic={maxThreadLogic} props={threadProps}>
                        <QuestionInput />
                    </BindLogic>
                </BindLogic>
            </Provider>
        ).container
    })

    afterEach(() => {
        cleanup()
        threadLogicInstance?.unmount()
        maxLogicInstance?.cache.eventSourceController?.abort()
        maxLogicInstance?.unmount()
        jest.restoreAllMocks()
    })

    const slashCommandItem = (): HTMLElement | null => screen.queryByText('/init')
    const imageFile = (name = 'screenshot.png'): File =>
        new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })

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

    it('adds pending screenshot chips from picker, removes them, and allows re-adding', async () => {
        const fileInput = screen.getByLabelText('Attach PNG or JPEG screenshots') as HTMLInputElement
        const file = imageFile()

        fireEvent.change(fileInput, { target: { files: [file] } })
        await waitFor(() => expect(screen.getByText('screenshot.png')).toBeInTheDocument())
        expect(conversationAttachmentsCreate).toHaveBeenCalledTimes(1)

        fireEvent.click(container.querySelector('[data-attr="max-remove-image-attachment"]') as HTMLElement)
        await waitFor(() => expect(screen.queryByText('screenshot.png')).not.toBeInTheDocument())
        expect(conversationAttachmentsDestroy).toHaveBeenCalledWith(expect.any(String), 'attachment-1')

        fireEvent.change(fileInput, { target: { files: [file] } })
        await waitFor(() => expect(screen.getByText('screenshot.png')).toBeInTheDocument())
        expect(conversationAttachmentsCreate).toHaveBeenCalledTimes(2)
    })

    it('adds screenshots from paste and drop events', async () => {
        const input = screen.getByRole('textbox') as HTMLTextAreaElement
        const pasteFile = imageFile('pasted.png')
        const dropFile = imageFile('dropped.png')

        fireEvent.paste(input, {
            clipboardData: {
                items: [{ kind: 'file', type: 'image/png', getAsFile: () => pasteFile }],
            },
        })
        await waitFor(() => expect(screen.getByText('pasted.png')).toBeInTheDocument())

        fireEvent.drop(input.closest('label') as HTMLElement, {
            dataTransfer: {
                types: ['Files'],
                files: [dropFile],
            },
        })
        await waitFor(() => expect(screen.getByText('dropped.png')).toBeInTheDocument())
    })

    it('blocks submit while an upload is pending and exposes retry on upload failure', async () => {
        let rejectUpload: (error: unknown) => void = () => {}
        ;(conversationAttachmentsCreate as jest.Mock).mockImplementation(
            () =>
                new Promise((_resolve, reject) => {
                    rejectUpload = reject
                })
        )

        fireEvent.change(screen.getByLabelText('Attach PNG or JPEG screenshots'), {
            target: { files: [imageFile()] },
        })
        await waitFor(() => expect(screen.getByText('screenshot.png')).toBeInTheDocument())

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'describe this' } })
        expect(threadLogicInstance.values.submissionDisabledReason).toBe('Wait for image upload to finish')

        rejectUpload({ data: { file: 'bad file' } })
        await waitFor(() => expect(screen.getByText('Failed to upload image.')).toBeInTheDocument())

        ;(conversationAttachmentsCreate as jest.Mock).mockResolvedValue({
            id: 'attachment-retried',
            filename: 'screenshot.png',
            content_type: 'image/png',
            byte_size: 3,
        })
        fireEvent.click(container.querySelector('[data-attr="max-retry-image-attachment"]') as HTMLElement)
        await waitFor(() => expect(screen.queryByText('Failed to upload image.')).not.toBeInTheDocument())
    })
})
