import {
    ACCOUNTS_HEALTH_COLUMN,
    ACCOUNTS_HOGQL_DEFAULT_SELECT,
    ACCOUNTS_NAME_COLUMN,
    ensureMandatoryColumns,
} from './accountsColumnConfigLogic'

describe('accountsColumnConfigLogic columns', () => {
    describe('ACCOUNTS_HOGQL_DEFAULT_SELECT', () => {
        it('puts the mandatory name and health columns first, in that order', () => {
            expect(ACCOUNTS_HOGQL_DEFAULT_SELECT[0]).toBe(ACCOUNTS_NAME_COLUMN)
            expect(ACCOUNTS_HOGQL_DEFAULT_SELECT[1]).toBe(ACCOUNTS_HEALTH_COLUMN)
        })
    })

    describe('ensureMandatoryColumns', () => {
        it('adds both mandatory columns to an empty list', () => {
            expect(ensureMandatoryColumns([])).toEqual([ACCOUNTS_NAME_COLUMN, ACCOUNTS_HEALTH_COLUMN])
        })

        it('upgrades a legacy config that predates the health column', () => {
            expect(ensureMandatoryColumns([ACCOUNTS_NAME_COLUMN, 'csm', 'account_owner'])).toEqual([
                ACCOUNTS_NAME_COLUMN,
                ACCOUNTS_HEALTH_COLUMN,
                'csm',
                'account_owner',
            ])
        })

        it('pins health right after name wherever name sits', () => {
            expect(ensureMandatoryColumns(['csm', ACCOUNTS_NAME_COLUMN, 'account_owner'])).toEqual([
                'csm',
                ACCOUNTS_NAME_COLUMN,
                ACCOUNTS_HEALTH_COLUMN,
                'account_owner',
            ])
        })

        it('is idempotent on an already-upgraded list', () => {
            const upgraded = [ACCOUNTS_NAME_COLUMN, ACCOUNTS_HEALTH_COLUMN, 'csm']
            expect(ensureMandatoryColumns(upgraded)).toEqual(upgraded)
        })

        it('moves a misplaced health column back to right after name', () => {
            expect(ensureMandatoryColumns([ACCOUNTS_NAME_COLUMN, 'csm', ACCOUNTS_HEALTH_COLUMN])).toEqual([
                ACCOUNTS_NAME_COLUMN,
                ACCOUNTS_HEALTH_COLUMN,
                'csm',
            ])
        })

        it('replaces an expression that aliases the reserved health column', () => {
            expect(
                ensureMandatoryColumns([ACCOUNTS_NAME_COLUMN, 'properties.plan AS health_score', 'account_owner'])
            ).toEqual([ACCOUNTS_NAME_COLUMN, ACCOUNTS_HEALTH_COLUMN, 'account_owner'])
        })
    })
})
