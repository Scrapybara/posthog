import { MOCK_DEFAULT_TEAM } from 'lib/api.mock'

import '@testing-library/jest-dom'

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { filterTestAccountsDefaultsLogic } from 'scenes/settings/environment/filterTestAccountDefaultsLogic'

import { initKeaTests } from '~/test/init'
import { PropertyFilterType, PropertyOperator } from '~/types'

import { EditLiveActivityWidgetModal } from './EditLiveActivityWidgetModal'

describe('EditLiveActivityWidgetModal', () => {
    afterEach(() => {
        cleanup()
    })

    beforeEach(() => {
        initKeaTests(true, {
            ...MOCK_DEFAULT_TEAM,
            test_account_filters: [
                {
                    key: 'email',
                    value: '@posthog.com',
                    operator: PropertyOperator.NotIContains,
                    type: PropertyFilterType.Person,
                },
            ],
        })
        filterTestAccountsDefaultsLogic.mount()
    })

    it('saves widget config from default live activity settings', async () => {
        const onSave = jest.fn().mockResolvedValue(undefined)

        render(
            <EditLiveActivityWidgetModal
                isOpen
                onClose={jest.fn()}
                config={{
                    limit: 5,
                    refreshIntervalSeconds: 15,
                    filterTestAccounts: true,
                }}
                onSave={onSave}
            />
        )

        const dialog = screen.getByRole('dialog')
        await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

        expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({
                limit: 5,
                refreshIntervalSeconds: 15,
                filterTestAccounts: true,
            }),
            {}
        )
    })

    it('shows inline errors for too-fast refresh intervals instead of saving', async () => {
        const onSave = jest.fn()

        render(
            <EditLiveActivityWidgetModal
                isOpen
                onClose={jest.fn()}
                config={{ limit: 5, refreshIntervalSeconds: 15 }}
                onSave={onSave}
            />
        )

        const refreshIntervalInput = screen.getAllByRole('spinbutton')[1]
        await userEvent.clear(refreshIntervalInput)
        await userEvent.type(refreshIntervalInput, '5')

        expect(screen.getByText('Too small: expected number to be >=15')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true')
        expect(onSave).not.toHaveBeenCalled()
    })
})
