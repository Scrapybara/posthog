import '@testing-library/jest-dom'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BindLogic, Provider } from 'kea'

import { FEATURE_FLAGS } from 'lib/constants'
import { featureFlagLogic } from 'lib/logic/featureFlagLogic'
import { projectLogic } from 'scenes/projectLogic'

import { useMocks } from '~/mocks/jest'
import { initKeaTests } from '~/test/init'

import {
    assistantAttachmentsDeleteCreate,
    assistantAttachmentsFinalizeCreate,
    assistantAttachmentsPrepareCreate,
} from 'products/posthog_ai/frontend/generated/api'

import { handsFreeLogic } from '../handsFreeLogic'
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
    assistantAttachmentsPrepareCreate: jest.fn(),
    assistantAttachmentsFinalizeCreate: jest.fn(),
    assistantAttachmentsDeleteCreate: jest.fn(),
}))

describe('QuestionInput', () => {
    let maxLogicInstance: ReturnType<typeof maxLogic.build>
    let projectLogicInstance: ReturnType<typeof projectLogic.build>
    let threadLogicInstance: ReturnType<typeof maxThreadLogic.build>

    beforeEach(() => {
        useMocks(maxMocks)
        initKeaTests()
        Object.defineProperty(URL, 'createObjectURL', {
            configurable: true,
            value: jest.fn((file: File) => `blob:${file.name}`),
        })
        Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() })
        const baseFetch = global.fetch.bind(global)
        global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
            if (input === 'https://upload.test') {
                return Promise.resolve({ ok: true } as Response)
            }
            return baseFetch(input, init)
        }) as any
        ;(assistantAttachmentsPrepareCreate as jest.Mock).mockResolvedValue({
            attachments: [
                {
                    id: 'attachment-1',
                    file_name: 'upload.png',
                    content_type: 'image/png',
                    size: 1,
                    upload_url: 'https://upload.test',
                    upload_fields: { key: 'value' },
                },
            ],
        })
        ;(assistantAttachmentsFinalizeCreate as jest.Mock).mockResolvedValue({
            id: 'attachment-1',
            file_name: 'upload.png',
            content_type: 'image/png',
            size: 1,
            width: 1,
            height: 1,
        })
        ;(assistantAttachmentsDeleteCreate as jest.Mock).mockResolvedValue(undefined)

        const maxGlobalLogicInstance = maxGlobalLogic()
        maxGlobalLogicInstance.mount()
        jest.spyOn(maxGlobalLogicInstance.selectors, 'dataProcessingAccepted').mockReturnValue(true)

        maxLogicInstance = maxLogic({ panelId: 'test' })
        maxLogicInstance.mount()

        projectLogicInstance = projectLogic()
        projectLogicInstance.mount()
        projectLogicInstance.actions.loadCurrentProjectSuccess({ id: 1, name: 'Test project' } as any)

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
        projectLogicInstance?.unmount()
        jest.restoreAllMocks()
    })

    const slashCommandItem = (): HTMLElement | null => screen.queryByText('/init')

    const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

    it('does not release a sandbox pre-warm when blur moves to the send button', async () => {
        // Simulate a completed warm; a release would clear the flag (and relay-cancel the warm Run).
        threadLogicInstance.cache.prewarmed = true
        threadLogicInstance.cache.prewarming = false

        const input = screen.getByRole('textbox') as HTMLTextAreaElement
        const sendButton = document.querySelector('[data-attr="max-send-message"]') as HTMLElement
        expect(sendButton).not.toBeNull()

        // Clicking send blurs the textarea before the click fires the send — the warm must survive.
        fireEvent.blur(input, { relatedTarget: sendButton })
        await flush()

        // Blur-to-send does not trigger releaseSandboxPrewarm, so the warm is untouched.
        expect(threadLogicInstance.cache.prewarmed).toBe(true)
    })

    it('releases a sandbox pre-warm when blur leaves the input for somewhere else', async () => {
        threadLogicInstance.cache.prewarmed = true
        threadLogicInstance.cache.prewarming = false

        const input = screen.getByRole('textbox') as HTMLTextAreaElement

        fireEvent.blur(input, { relatedTarget: null })
        await flush()

        // Blur-away triggers releaseSandboxPrewarm, which clears the flag (and relay-cancels any warm Run).
        expect(threadLogicInstance.cache.prewarmed).toBe(false)
    })

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

    it('keeps send disabled for a blank message even after an attachment is ready', async () => {
        threadLogicInstance.actions.setIsSandboxMode(true)
        await waitFor(() => expect(screen.getByLabelText('Choose PNG or JPEG images')).toBeInTheDocument())
        const fileInput = screen.getByLabelText('Choose PNG or JPEG images') as HTMLInputElement
        const sendButton = document.querySelector('[data-attr="max-send-message"]') as HTMLElement

        fireEvent.change(fileInput, {
            target: { files: [new File(['a'], 'upload.png', { type: 'image/png' })] },
        })

        await waitFor(() => expect(screen.getByText('upload.png')).toBeInTheDocument())
        await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument())
        expect(sendButton).toHaveAttribute('aria-disabled', 'true')
    })

    it('disables hands-free mode while an image is staged', async () => {
        featureFlagLogic.actions.setFeatureFlags([FEATURE_FLAGS.MAX_HANDS_FREE], {
            [FEATURE_FLAGS.MAX_HANDS_FREE]: true,
        })
        handsFreeLogic({ panelId: 'test' }).actions.setSdkAvailable(true)
        threadLogicInstance.actions.setIsSandboxMode(true)
        await waitFor(() => expect(screen.getByLabelText('Choose PNG or JPEG images')).toBeInTheDocument())

        fireEvent.change(screen.getByLabelText('Choose PNG or JPEG images'), {
            target: { files: [new File(['a'], 'upload.png', { type: 'image/png' })] },
        })

        await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument())
        expect(screen.getByLabelText('Enter hands-free')).toHaveAttribute('aria-disabled', 'true')
    })

    it.each([
        [
            'drop',
            (input: HTMLElement, file: File) =>
                fireEvent.drop(input.closest('label') as HTMLElement, {
                    dataTransfer: { files: [file], types: ['Files'] },
                }),
        ],
        [
            'paste',
            (input: HTMLElement, file: File) =>
                fireEvent.paste(input, {
                    clipboardData: {
                        items: [
                            {
                                kind: 'file',
                                getAsFile: () => file,
                            },
                        ],
                    },
                }),
        ],
    ])('adds sandbox attachments via %s', async (method, addFile) => {
        threadLogicInstance.actions.setIsSandboxMode(true)
        await waitFor(() => expect(screen.getByLabelText('Choose PNG or JPEG images')).toBeInTheDocument())
        const input = screen.getByRole('textbox')
        const composer = input.closest('label') as HTMLElement
        const file = new File(['a'], `from-${method}.png`, { type: 'image/png' })

        if (method === 'drop') {
            fireEvent.dragEnter(composer, { dataTransfer: { files: [file], types: ['Files'] } })
            await waitFor(() => expect(composer.className).toContain('bg-accent-highlight-secondary/20'))
        }

        addFile(input, file)

        await waitFor(() => expect(screen.getByText(`from-${method}.png`)).toBeInTheDocument())
        await waitFor(() => expect(screen.getByText('Ready')).toBeInTheDocument())
        await waitFor(() => expect(composer.className).not.toContain('bg-accent-highlight-secondary/20'))
    })

    describe('stop button cancel state', () => {
        const sendButton = (): HTMLElement | null => document.querySelector('[data-attr="max-send-message"]')
        const stopButton = (): HTMLElement | null => document.querySelector('[data-attr="max-stop-generation"]')

        it('shows the stop affordance while streaming and not cancelling', async () => {
            threadLogicInstance.actions.reconnectToStream()
            await waitFor(() => expect(stopButton()).not.toBeNull())
            expect(sendButton()).toHaveAttribute('aria-disabled', 'true')
        })

        it('shows send (not stop) while cancelLoading is true', async () => {
            threadLogicInstance.actions.reconnectToStream()
            threadLogicInstance.actions.setCancelLoading(true)

            await waitFor(() => expect(sendButton()).not.toBeNull())
            expect(stopButton()).toBeNull()
            // The composer button reads "Cancelling…" via disabledReason, never "Let's bail".
            expect(screen.queryByText("Let's bail")).not.toBeInTheDocument()
        })

        it('returns to send (not stop) after cancel resolves and loading clears', async () => {
            threadLogicInstance.actions.reconnectToStream()
            threadLogicInstance.actions.setCancelLoading(true)
            await waitFor(() => expect(sendButton()).not.toBeNull())

            // Cancel resolves: streaming ends and cancelLoading clears -> threadLoading false.
            threadLogicInstance.actions.endStreaming()
            threadLogicInstance.actions.setCancelLoading(false)

            await waitFor(() => expect(sendButton()).not.toBeNull())
            expect(stopButton()).toBeNull()
            expect(screen.queryByText("Let's bail")).not.toBeInTheDocument()
        })
    })
})
