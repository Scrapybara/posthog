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

    it('keeps long content in the internally scrolling textarea while controls stay mounted', async () => {
        renderQuestionInput()
        const input = screen.getByRole('textbox') as HTMLTextAreaElement
        const longPrompt = Array.from({ length: 40 }, (_, index) => `Line ${index + 1}: explain this`).join('\n')

        fireEvent.change(input, { target: { value: longPrompt } })

        await waitFor(() => expect(input).toHaveValue(longPrompt))
        expect(input).toHaveClass('QuestionInput__textarea')
        expect(input).toHaveClass('overflow-y-auto')
        expect(input).toHaveClass('resize-none')
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

    it('keeps empty and loading controls disabled', () => {
        renderQuestionInput()

        expect(document.querySelector('[data-attr="max-send-message"]')).toHaveAttribute('aria-disabled', 'true')

        cleanup()
        jest.spyOn(maxGlobalLogicInstance.selectors, 'dataProcessingAccepted').mockReturnValue(false)
        jest.spyOn(threadLogicInstance.selectors, 'threadLoading').mockReturnValue(true)
        jest.spyOn(threadLogicInstance.selectors, 'inputDisabled').mockReturnValue(true)
        renderQuestionInput()

        expect(screen.getByRole('textbox')).toBeDisabled()
        const stopButton = document.querySelector('[data-attr="max-stop-generation"]')
        expect(stopButton).toHaveClass('LemonButton--loading')
        expect(stopButton).toHaveAttribute('aria-disabled', 'true')
    })
})
