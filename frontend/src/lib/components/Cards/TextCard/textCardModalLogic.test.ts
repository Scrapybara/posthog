import { expectLogic } from 'kea-test-utils'

import { lemonToast } from '@posthog/lemon-ui'
import {
    dashboardsCreateTextTileCreate,
    dashboardsUpdateTextTileCreate,
} from '@posthog/products-dashboards/frontend/generated/api'

import { initKeaTests } from '~/test/init'
import { AccessControlLevel, DashboardType, QueryBasedInsightModel } from '~/types'

import { textCardModalLogic } from './textCardModalLogic'
import { buildDashboardSectionHeaderBody } from './textCardSectionHeader'

jest.mock('@posthog/products-dashboards/frontend/generated/api', () => ({
    dashboardsCreateTextTileCreate: jest.fn(),
    dashboardsUpdateTextTileCreate: jest.fn(),
}))

const makeDashboard = (body: string = 'existing text'): DashboardType<QueryBasedInsightModel> =>
    ({
        id: 123,
        name: 'Test dashboard',
        description: '',
        pinned: false,
        created_at: '2024-01-01T00:00:00Z',
        created_by: null,
        last_accessed_at: null,
        is_shared: false,
        deleted: false,
        creation_mode: 'default',
        tiles: [
            {
                id: 1,
                color: null,
                layouts: {},
                text: {
                    body,
                    last_modified_at: '2024-01-01T00:00:00Z',
                },
                transparent_background: false,
            },
        ],
        filters: {},
        tags: [],
        user_access_level: AccessControlLevel.Editor,
    }) as DashboardType<QueryBasedInsightModel>

describe('textCardModalLogic', () => {
    beforeEach(() => {
        initKeaTests()
        jest.spyOn(lemonToast, 'error').mockImplementation(jest.fn())
        jest.mocked(dashboardsCreateTextTileCreate).mockReset()
        jest.mocked(dashboardsUpdateTextTileCreate).mockReset()
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('does not show toast for expected form validation errors', async () => {
        const logic = textCardModalLogic({
            dashboard: makeDashboard('x'.repeat(4001)),
            textTileId: 1,
            onClose: jest.fn(),
        })
        logic.mount()

        await expectLogic(logic).toMatchValues({
            textTileValidationErrors: {
                body: 'Text is too long (4000 characters max)',
                title: null,
                description: null,
            },
        })

        logic.actions.submitTextTileFailure({ error: 'Validation failed', errors: {} } as any, {})

        expect(lemonToast.error).not.toHaveBeenCalled()
    })

    it('rejects empty text card body in form validation', async () => {
        const logic = textCardModalLogic({
            dashboard: makeDashboard(''),
            textTileId: 'new',
            onClose: jest.fn(),
        })
        logic.mount()

        await expectLogic(logic).toMatchValues({
            textTileValidationErrors: {
                body: 'This card would be empty! Type something first',
                title: null,
                description: null,
            },
        })

        logic.actions.submitTextTileFailure({ error: 'Validation failed', errors: {} } as any, {})

        expect(lemonToast.error).not.toHaveBeenCalled()
    })

    it('does not show toast for expected api body validation errors', () => {
        const logic = textCardModalLogic({
            dashboard: makeDashboard('valid'),
            textTileId: 1,
            onClose: jest.fn(),
        })
        logic.mount()

        logic.actions.submitTextTileFailure(
            {
                error: 'Validation failed',
                errors: {},
            } as any,
            { body: ['Text is too long (4000 characters max)'] }
        )

        expect(lemonToast.error).not.toHaveBeenCalled()
    })

    it('shows toast for unexpected submit failures', () => {
        const logic = textCardModalLogic({
            dashboard: makeDashboard('valid'),
            textTileId: 1,
            onClose: jest.fn(),
        })
        logic.mount()

        logic.actions.submitTextTileFailure(
            {
                error: 'Network error',
                errors: {},
            } as any,
            {}
        )

        expect(lemonToast.error).toHaveBeenCalledWith('Could not save text: Network error')
    })

    it('creates section headers through the generated text tile API', async () => {
        const dashboard = makeDashboard()
        const onClose = jest.fn()
        const savedBody = buildDashboardSectionHeaderBody({
            title: 'Activation funnel',
            description: 'Signup to paid conversion',
        })
        jest.mocked(dashboardsCreateTextTileCreate).mockResolvedValue({
            id: 2,
            text: { body: savedBody },
            layouts: { sm: { x: 0, y: 3, w: 12, h: 1 } },
            transparent_background: true,
        } as any)

        const logic = textCardModalLogic({
            dashboard,
            textTileId: 'new',
            onClose,
            kind: 'section',
            smLayouts: [{ y: 0, h: 3 }],
        })
        logic.mount()
        logic.actions.setTextTileValue('title', 'Activation funnel')
        logic.actions.setTextTileValue('description', 'Signup to paid conversion')

        await expectLogic(logic, () => {
            logic.actions.submitTextTile()
        })
            .delay(0)
            .toDispatchActions(['submitTextTile', 'submitTextTileSuccess'])

        expect(dashboardsCreateTextTileCreate).toHaveBeenCalledWith(expect.any(String), dashboard.id, {
            body: savedBody,
            transparent_background: true,
            layouts: { sm: { x: 0, y: 3, w: 12, h: 1 } },
        })
        expect(onClose).toHaveBeenCalled()
    })

    it('updates existing section headers through the generated text tile API', async () => {
        const originalBody = buildDashboardSectionHeaderBody({ title: 'Original', description: 'Old' })
        const dashboard = makeDashboard(originalBody)
        dashboard.tiles[0].transparent_background = true
        const updatedBody = buildDashboardSectionHeaderBody({ title: 'Updated', description: 'New' })
        jest.mocked(dashboardsUpdateTextTileCreate).mockResolvedValue({
            id: 1,
            text: { body: updatedBody },
            layouts: {},
            transparent_background: true,
        } as any)

        const logic = textCardModalLogic({
            dashboard,
            textTileId: 1,
            onClose: jest.fn(),
            kind: 'section',
        })
        logic.mount()
        logic.actions.setTextTileValue('title', 'Updated')
        logic.actions.setTextTileValue('description', 'New')

        await expectLogic(logic, () => {
            logic.actions.submitTextTile()
        })
            .delay(0)
            .toDispatchActions(['submitTextTile', 'submitTextTileSuccess'])

        expect(dashboardsUpdateTextTileCreate).toHaveBeenCalledWith(expect.any(String), dashboard.id, {
            tile_id: 1,
            body: updatedBody,
            transparent_background: true,
        })
    })
})
