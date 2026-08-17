import '@testing-library/jest-dom'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BindLogic, Provider } from 'kea'
import type { ComponentProps } from 'react'

import { useMocks } from '~/mocks/jest'
import { initKeaTests } from '~/test/init'

import { maxGlobalLogic } from '../maxGlobalLogic'
import { maxLogic } from '../maxLogic'
import { maxThreadLogic } from '../maxThreadLogic'
import { maxMocks, mockStream } from '../testUtils'
import { QuestionInput } from './QuestionInput'

jest.mock(
    '@posthog/hogvm',
    () => ({
        exec: jest.fn(),
        execAsync: jest.fn(),
    }),
    { virtual: true }
)

describe('QuestionInput', () => {
    let maxLogicInstance: ReturnType<typeof maxLogic.build>
    let threadLogicInstance: ReturnType<typeof maxThreadLogic.build>
    let maxGlobalLogicInstance: ReturnType<typeof maxGlobalLogic.build>
    let threadProps: { panelId: string; conversationId: string }

    beforeEach(() => {
        useMocks(maxMocks)
        initKeaTests()

        maxGlobalLogicInstance = maxGlobalLogic()
        maxGlobalLogicInstance.mount()
        jest.spyOn(maxGlobalLogicInstance.selectors, 'dataProcessingAccepted').mockReturnValue(true)

        maxLogicInstance = maxLogic({ panelId: 'test' })
        maxLogicInstance.mount()

        threadProps = { panelId: 'test', conversationId: maxLogicInstance.values.frontendConversationId }
        threadLogicInstance = maxThreadLogic(threadProps)
        threadLogicInstance.mount()
    })

    function renderQuestionInput(props: Partial<ComponentProps<typeof QuestionInput>> = {}): void {
        render(
            <Provider>
                <BindLogic logic={maxLogic} props={{ panelId: 'test' }}>
                    <BindLogic logic={maxThreadLogic} props={threadProps}>
                        <QuestionInput {...props} />
                    </BindLogic>
                </BindLogic>
            </Provider>
        )
    }

    afterEach(() => {
        cleanup()
        threadLogicInstance?.unmount()
        maxLogicInstance?.cache.eventSourceController?.abort()
        maxLogicInstance?.unmount()
        jest.restoreAllMocks()
    })

    const slashCommandItem = (): HTMLElement | null => screen.queryByText('/init')

    const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

    it('does not release a sandbox pre-warm when blur moves to the send button', async () => {
        renderQuestionInput()
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
        renderQuestionInput()
        threadLogicInstance.cache.prewarmed = true
        threadLogicInstance.cache.prewarming = false

        const input = screen.getByRole('textbox') as HTMLTextAreaElement

        fireEvent.blur(input, { relatedTarget: null })
        await flush()

        // Blur-away triggers releaseSandboxPrewarm, which clears the flag (and relay-cancels any warm Run).
        expect(threadLogicInstance.cache.prewarmed).toBe(false)
    })

    it('reopens the popover after Escape dismisses it and a fresh slash is typed', async () => {
        renderQuestionInput()
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

    it('keeps long content in the scrolling textarea while the send control stays mounted', async () => {
        renderQuestionInput()
        const input = screen.getByRole('textbox') as HTMLTextAreaElement
        const longPrompt = Array.from({ length: 40 }, (_, index) => `Line ${index + 1}: explain this`).join('\n')

        fireEvent.change(input, { target: { value: longPrompt } })

        await waitFor(() => expect(input).toHaveValue(longPrompt))
        expect(input).toHaveClass('max-h-[min(35dvh,13.5rem)]')
        expect(input).toHaveClass('overflow-y-auto')
        expect(document.querySelector('[data-attr="max-send-message"]')).toBeInTheDocument()
    })

    it('submits with Enter and preserves Shift+Enter for new lines', async () => {
        mockStream()
        const onSubmit = jest.fn()
        renderQuestionInput({ onSubmit })
        const input = screen.getByRole('textbox') as HTMLTextAreaElement

        fireEvent.change(input, { target: { value: 'Explain activation trends' } })
        await waitFor(() => expect(input).toHaveValue('Explain activation trends'))

        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
        expect(onSubmit).not.toHaveBeenCalled()

        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    it('disables empty and loading composer states', async () => {
        renderQuestionInput()
        expect(document.querySelector('[data-attr="max-send-message"]')).toHaveAttribute('aria-disabled', 'true')

        cleanup()
        jest.spyOn(maxGlobalLogicInstance.selectors, 'dataProcessingAccepted').mockReturnValue(false)
        threadLogicInstance.actions.reconnectToStream()
        renderQuestionInput()

        expect(threadLogicInstance.values.threadLoading).toBe(true)
        await waitFor(() => expect(screen.getByRole('textbox')).toBeDisabled())
    })

    describe('stop button cancel state', () => {
        const sendButton = (): HTMLElement | null => document.querySelector('[data-attr="max-send-message"]')
        const stopButton = (): HTMLElement | null => document.querySelector('[data-attr="max-stop-generation"]')

        it('shows the stop affordance while streaming and not cancelling', async () => {
            renderQuestionInput()
            threadLogicInstance.actions.reconnectToStream()
            await waitFor(() => expect(stopButton()).not.toBeNull())
            expect(sendButton()).toHaveAttribute('aria-disabled', 'true')
        })

        it('shows send (not stop) while cancelLoading is true', async () => {
            renderQuestionInput()
            threadLogicInstance.actions.reconnectToStream()
            threadLogicInstance.actions.setCancelLoading(true)

            await waitFor(() => expect(sendButton()).not.toBeNull())
            expect(stopButton()).toBeNull()
            // The composer button reads "Cancelling…" via disabledReason, never "Let's bail".
            expect(screen.queryByText("Let's bail")).not.toBeInTheDocument()
        })

        it('returns to send (not stop) after cancel resolves and loading clears', async () => {
            renderQuestionInput()
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
