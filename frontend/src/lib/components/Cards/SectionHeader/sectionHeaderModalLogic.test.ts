import { expectLogic } from 'kea-test-utils'
import posthog from 'posthog-js'

import { lemonToast } from '@posthog/lemon-ui'

import api from 'lib/api'
import { composeSectionHeaderBody } from 'lib/components/Cards/SectionHeader/sectionHeaderMarkdown'

import { useMocks } from '~/mocks/jest'
import { initKeaTests } from '~/test/init'
import { AccessControlLevel, DashboardTile, DashboardType, QueryBasedInsightModel } from '~/types'

import { sectionHeaderDefaultLayouts, sectionHeaderModalLogic } from './sectionHeaderModalLogic'

const DASHBOARD_ID = 123

const makeDashboard = (
    tiles: Partial<DashboardTile<QueryBasedInsightModel>>[]
): DashboardType<QueryBasedInsightModel> =>
    ({
        id: DASHBOARD_ID,
        name: 'Test dashboard',
        description: '',
        pinned: false,
        created_at: '2024-01-01T00:00:00Z',
        created_by: null,
        last_accessed_at: null,
        is_shared: false,
        deleted: false,
        creation_mode: 'default',
        tiles,
        filters: {},
        tags: [],
        user_access_level: AccessControlLevel.Editor,
    }) as DashboardType<QueryBasedInsightModel>

const insightTile = (id: number, y: number, h: number): Partial<DashboardTile<QueryBasedInsightModel>> => ({
    id,
    layouts: { sm: { x: 0, y, w: 6, h }, xs: { x: 0, y, w: 1, h } },
})

const sectionTile = (
    id: number,
    fields: { title: string; description: string }
): Partial<DashboardTile<QueryBasedInsightModel>> => ({
    id,
    transparent_background: true,
    layouts: { sm: { x: 0, y: 0, w: 12, h: 2 }, xs: { x: 0, y: 0, w: 1, h: 2 } },
    text: { body: composeSectionHeaderBody(fields), last_modified_at: '2024-01-01T00:00:00Z' },
})

describe('sectionHeaderDefaultLayouts', () => {
    it('spans the full 12-column grid and starts a new row below every tile', () => {
        const layouts = sectionHeaderDefaultLayouts([insightTile(1, 0, 5), insightTile(2, 5, 4)])
        expect(layouts.sm).toEqual({ x: 0, y: 9, w: 12, h: 2 })
    })

    it('places the first section at the top of an empty dashboard', () => {
        expect(sectionHeaderDefaultLayouts([]).sm).toEqual({ x: 0, y: 0, w: 12, h: 2 })
    })

    it('uses a single column on narrow (xs) dashboards', () => {
        const layouts = sectionHeaderDefaultLayouts([insightTile(1, 0, 5)])
        expect(layouts.xs).toEqual({ x: 0, y: 5, w: 1, h: 2 })
    })
})

describe('sectionHeaderModalLogic', () => {
    beforeEach(() => {
        initKeaTests()
        useMocks({
            patch: {
                '/api/environments/:team_id/dashboards/:id/': () => [200, makeDashboard([])],
            },
        })
        jest.spyOn(lemonToast, 'error').mockImplementation(jest.fn())
        jest.spyOn(posthog, 'capture').mockImplementation(jest.fn() as any)
        jest.spyOn(api, 'update')
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('parses an existing section tile into the title and description fields', async () => {
        const logic = sectionHeaderModalLogic({
            dashboard: makeDashboard([sectionTile(1, { title: 'Acquisition', description: 'How users sign up' })]),
            sectionHeaderId: 1,
            onClose: jest.fn(),
        })
        logic.mount()

        await expectLogic(logic).toMatchValues({
            sectionHeader: { title: 'Acquisition', description: 'How users sign up' },
        })
    })

    it('requires a title', async () => {
        const logic = sectionHeaderModalLogic({
            dashboard: makeDashboard([]),
            sectionHeaderId: 'new',
            onClose: jest.fn(),
        })
        logic.mount()

        await expectLogic(logic).toMatchValues({
            sectionHeaderValidationErrors: { title: 'Give the section a title', description: null },
        })
    })

    it('rejects an over-long title', async () => {
        const logic = sectionHeaderModalLogic({
            dashboard: makeDashboard([]),
            sectionHeaderId: 'new',
            onClose: jest.fn(),
        })
        logic.mount()
        logic.actions.setSectionHeaderValue('title', 'x'.repeat(201))

        await expectLogic(logic).toMatchValues({
            sectionHeaderValidationErrors: { title: 'Title is too long (200 characters max)', description: null },
        })
    })

    it('rejects an over-long description', async () => {
        const logic = sectionHeaderModalLogic({
            dashboard: makeDashboard([]),
            sectionHeaderId: 'new',
            onClose: jest.fn(),
        })
        logic.mount()
        logic.actions.setSectionHeaderValues({ title: 'Fine', description: 'x'.repeat(301) })

        await expectLogic(logic).toMatchValues({
            sectionHeaderValidationErrors: {
                title: null,
                description: 'Description is too long (300 characters max)',
            },
        })
    })

    it('rejects a description that would become a markdown block', async () => {
        const logic = sectionHeaderModalLogic({
            dashboard: makeDashboard([]),
            sectionHeaderId: 'new',
            onClose: jest.fn(),
        })
        logic.mount()
        logic.actions.setSectionHeaderValues({ title: 'Fine', description: '- a bullet line' })

        await expectLogic(logic).toMatchValues({
            sectionHeaderValidationErrors: {
                title: null,
                description: 'Remove block formatting (like -, >, #, or ---) from the start of the description',
            },
        })
    })

    it('creates a transparent, full-width section header tile and resets the form on success', async () => {
        const onClose = jest.fn()
        const logic = sectionHeaderModalLogic({
            dashboard: makeDashboard([insightTile(1, 0, 5)]),
            sectionHeaderId: 'new',
            onClose,
        })
        logic.mount()
        logic.actions.setSectionHeaderValues({ title: 'Engagement', description: 'Weekly retention' })

        await expectLogic(logic, () => {
            logic.actions.submitSectionHeader()
        }).toDispatchActions(['submitSectionHeader', 'submitSectionHeaderSuccess'])

        expect(api.update).toHaveBeenCalledWith(
            expect.stringContaining(`dashboards/${DASHBOARD_ID}`),
            expect.objectContaining({
                tiles: [
                    expect.objectContaining({
                        text: {
                            body: composeSectionHeaderBody({ title: 'Engagement', description: 'Weekly retention' }),
                        },
                        transparent_background: true,
                        layouts: expect.objectContaining({ sm: { x: 0, y: 5, w: 12, h: 2 } }),
                    }),
                ],
            })
        )
        expect(posthog.capture).toHaveBeenCalledWith(
            'dashboard section header saved',
            expect.objectContaining({ dashboard_id: DASHBOARD_ID, is_new: true, has_description: true })
        )
        expect(onClose).toHaveBeenCalledTimes(1)
        // The keyed logic is shared with the next create, so a successful save must clear the form.
        await expectLogic(logic).toMatchValues({ sectionHeader: { title: '', description: '' } })
    })

    it('updates an existing section header in place without changing its layout', async () => {
        const logic = sectionHeaderModalLogic({
            dashboard: makeDashboard([sectionTile(7, { title: 'Old', description: 'old desc' })]),
            sectionHeaderId: 7,
            onClose: jest.fn(),
        })
        logic.mount()
        logic.actions.setSectionHeaderValue('title', 'New title')

        await expectLogic(logic, () => {
            logic.actions.submitSectionHeader()
        }).toDispatchActions(['submitSectionHeader', 'submitSectionHeaderSuccess'])

        const updateCall = (api.update as jest.Mock).mock.calls.at(-1)
        const payload = updateCall?.[1] as {
            tiles: { id: number; transparent_background: boolean; layouts?: unknown }[]
        }
        expect(payload.tiles[0]).toEqual(
            expect.objectContaining({
                id: 7,
                transparent_background: true,
            })
        )
        expect(payload.tiles[0].layouts).toBeUndefined()
    })

    it('keeps the modal open and toasts when the save fails', async () => {
        useMocks({
            patch: {
                '/api/environments/:team_id/dashboards/:id/': () => [500, { detail: 'server exploded' }],
            },
        })
        const onClose = jest.fn()
        const logic = sectionHeaderModalLogic({
            dashboard: makeDashboard([insightTile(1, 0, 5)]),
            sectionHeaderId: 'new',
            onClose,
        })
        logic.mount()
        logic.actions.setSectionHeaderValues({ title: 'Engagement', description: 'Weekly retention' })

        await expectLogic(logic, () => {
            logic.actions.submitSectionHeader()
        }).toDispatchActions(['submitSectionHeader', 'submitSectionHeaderFailure'])

        expect(onClose).not.toHaveBeenCalled()
        expect(lemonToast.error).toHaveBeenCalled()
        expect(posthog.capture).not.toHaveBeenCalledWith('dashboard section header saved', expect.anything())
        // The form keeps the user's input so they can retry without retyping.
        await expectLogic(logic).toMatchValues({
            sectionHeader: { title: 'Engagement', description: 'Weekly retention' },
        })
    })

    it('shows a toast for unexpected submit failures', () => {
        const logic = sectionHeaderModalLogic({
            dashboard: makeDashboard([]),
            sectionHeaderId: 'new',
            onClose: jest.fn(),
        })
        logic.mount()

        logic.actions.submitSectionHeaderFailure({ error: 'Network error', errors: {} } as any, {})

        expect(lemonToast.error).toHaveBeenCalledWith('Could not save section header: Network error')
    })
})
