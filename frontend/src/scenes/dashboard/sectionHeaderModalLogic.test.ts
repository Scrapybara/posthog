import { api } from 'lib/api.mock'

import { expectLogic } from 'kea-test-utils'

import {
    parseDashboardSectionHeader,
    serializeDashboardSectionHeader,
} from 'lib/components/Cards/TextCard/sectionHeader'

import { initKeaTests } from '~/test/init'
import { AccessControlLevel, DashboardType, QueryBasedInsightModel } from '~/types'

import { sectionHeaderModalLogic } from './sectionHeaderModalLogic'

const makeDashboard = (): DashboardType<QueryBasedInsightModel> =>
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
                layouts: { sm: { x: 0, y: 0, w: 12, h: 5 } },
                text: {
                    body: serializeDashboardSectionHeader({
                        title: 'Existing section',
                        description: 'Existing description',
                    }),
                    last_modified_at: '2024-01-01T00:00:00Z',
                },
                transparent_background: true,
            },
        ],
        filters: {},
        tags: [],
        user_access_level: AccessControlLevel.Editor,
    }) as unknown as DashboardType<QueryBasedInsightModel>

describe('sectionHeaderModalLogic', () => {
    beforeEach(() => {
        initKeaTests()
        jest.spyOn(api, 'update').mockResolvedValue(makeDashboard())
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('creates a transparent full-width section on a new bottom row', async () => {
        const logic = sectionHeaderModalLogic({ dashboard: makeDashboard(), textTileId: 'new', onClose: jest.fn() })
        logic.mount()

        logic.actions.setSectionHeaderValues({ title: 'Activation', description: 'Users reaching value.' })
        logic.actions.submitSectionHeader()
        await expectLogic(logic).toFinishAllListeners()

        const update = api.update.mock.calls[0][1] as Record<string, any>
        expect(update.tiles[0]).toMatchObject({
            transparent_background: true,
            layouts: { sm: { x: 0, y: 5, w: 12, h: 1 } },
        })
        expect(parseDashboardSectionHeader(update.tiles[0].text.body)).toEqual({
            title: 'Activation',
            description: 'Users reaching value.',
        })
    })

    it('edits the existing text tile without changing its identity', async () => {
        const logic = sectionHeaderModalLogic({ dashboard: makeDashboard(), textTileId: 1, onClose: jest.fn() })
        logic.mount()

        await expectLogic(logic).toMatchValues({
            sectionHeader: { title: 'Existing section', description: 'Existing description' },
        })
        logic.actions.setSectionHeaderValues({ title: 'Updated section', description: '' })
        logic.actions.submitSectionHeader()
        await expectLogic(logic).toFinishAllListeners()

        const tile = (api.update.mock.calls[0][1] as Record<string, any>).tiles[0]
        expect(tile.id).toBe(1)
        expect(tile.transparent_background).toBe(true)
        expect(parseDashboardSectionHeader(tile.text.body)).toEqual({
            title: 'Updated section',
            description: '',
        })
    })

    it('requires a title', async () => {
        const logic = sectionHeaderModalLogic({ dashboard: makeDashboard(), textTileId: 'new', onClose: jest.fn() })
        logic.mount()

        await expectLogic(logic).toMatchValues({
            sectionHeaderValidationErrors: { title: 'Enter a section title', description: null },
        })
    })

    it('rejects content that exceeds text tile storage after encoding', async () => {
        const logic = sectionHeaderModalLogic({ dashboard: makeDashboard(), textTileId: 'new', onClose: jest.fn() })
        logic.mount()

        logic.actions.setSectionHeaderValues({ title: 'Activation', description: '漢'.repeat(500) })

        await expectLogic(logic).toMatchValues({
            sectionHeaderValidationErrors: { title: null, description: 'Shorten the title or description' },
        })
    })
})
