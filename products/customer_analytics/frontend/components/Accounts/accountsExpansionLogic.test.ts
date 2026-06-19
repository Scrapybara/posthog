import { expectLogic } from 'kea-test-utils'

import { initKeaTests } from '~/test/init'

import { accountsExpansionLogic, DEFAULT_ACCOUNT_TAB } from './accountsExpansionLogic'

describe('accountsExpansionLogic', () => {
    let logic: ReturnType<typeof accountsExpansionLogic.build>

    beforeEach(() => {
        initKeaTests()
        logic = accountsExpansionLogic()
        logic.mount()
    })

    afterEach(() => {
        logic.unmount()
    })

    it('defaults a freshly expanded account to the Health tab', () => {
        expect(DEFAULT_ACCOUNT_TAB).toBe('health')
        logic.actions.toggleAccountExpanded('acc-1')
        expect(logic.values.isAccountExpanded('acc-1')).toBe(true)
        expect(logic.values.activeTabFor('acc-1')).toBe('health')
    })

    it('openAccountTab expands the row and selects the given tab', () => {
        logic.actions.openAccountTab('acc-2', 'health')
        expect(logic.values.expandedAccountIds).toContain('acc-2')
        expect(logic.values.activeTabFor('acc-2')).toBe('health')
    })

    it('openAccountTab is idempotent for an already-expanded row', () => {
        logic.actions.toggleAccountExpanded('acc-3')
        logic.actions.setActiveTab('acc-3', 'notes')
        logic.actions.openAccountTab('acc-3', 'health')
        expect(logic.values.expandedAccountIds.filter((id) => id === 'acc-3')).toHaveLength(1)
        expect(logic.values.activeTabFor('acc-3')).toBe('health')
    })

    it('does not fire the tab-viewed event for programmatic openAccountTab', async () => {
        await expectLogic(logic, () => {
            logic.actions.openAccountTab('acc-4', 'health')
        }).toFinishAllListeners()
        expect(logic.values.activeTabFor('acc-4')).toBe('health')
    })
})
