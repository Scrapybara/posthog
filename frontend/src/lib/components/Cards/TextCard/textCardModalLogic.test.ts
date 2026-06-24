import { expectLogic } from 'kea-test-utils'
import posthog from 'posthog-js'

import { lemonToast } from '@posthog/lemon-ui'

import { useMocks } from '~/mocks/jest'
import { dashboardsModel } from '~/models/dashboardsModel'
import { initKeaTests } from '~/test/init'
import { AccessControlLevel, DashboardType, QueryBasedInsightModel } from '~/types'

import { textCardModalLogic } from './textCardModalLogic'

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
            },
        ],
        filters: {},
        tags: [],
        user_access_level: AccessControlLevel.Editor,
    }) as DashboardType<QueryBasedInsightModel>

describe('textCardModalLogic', () => {
    beforeEach(() => {
        initKeaTests()
        dashboardsModel.mount()
        jest.spyOn(lemonToast, 'error').mockImplementation(jest.fn())
        jest.spyOn(posthog, 'capture').mockImplementation(jest.fn())
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
            textTileValidationErrors: { body: 'Text is too long (4000 characters max)' },
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
            textTileValidationErrors: { body: 'This card would be empty! Type something first' },
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

    it('creates section headers as full-width transparent text tiles', async () => {
        let dashboardPatchPayload: Partial<DashboardType<QueryBasedInsightModel>> | null = null
        useMocks({
            patch: {
                '/api/environments/:team_id/dashboards/:id/': async (req) => {
                    dashboardPatchPayload = await req.json()
                    return [200, { ...makeDashboard('valid'), ...dashboardPatchPayload }]
                },
            },
        })
        const logic = textCardModalLogic({
            dashboard: makeDashboard('valid'),
            textTileId: 'new',
            textTileKind: 'section',
            defaultLayouts: { sm: { x: 0, y: 4, w: 12, h: 1 }, xs: { x: 0, y: 2, w: 1, h: 1 } },
            onClose: jest.fn(),
        })
        logic.mount()

        await expectLogic(logic, () => {
            logic.actions.setTextTileValue('body', 'Activation')
            logic.actions.submitTextTile()
        }).toFinishAllListeners()

        expect(dashboardPatchPayload).toEqual({
            tiles: [
                {
                    text: { body: '# Activation' },
                    transparent_background: true,
                    layouts: { sm: { x: 0, y: 4, w: 12, h: 1 }, xs: { x: 0, y: 2, w: 1, h: 1 } },
                },
            ],
        })
    })

    it('records when a section header is added', () => {
        const logic = textCardModalLogic({
            dashboard: makeDashboard('valid'),
            textTileId: 'new',
            textTileKind: 'section',
            onClose: jest.fn(),
        })
        logic.mount()

        logic.actions.submitTextTileSuccess({ body: 'Activation', transparent_background: true })

        expect(posthog.capture).toHaveBeenCalledWith('dashboard section header added', {
            dashboard_id: 123,
            title_length: 10,
        })
    })
})
