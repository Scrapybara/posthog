import { router } from 'kea-router'
import { expectLogic } from 'kea-test-utils'

import { createNewDefinition, definitionLogic } from 'scenes/data-management/definition/definitionLogic'
import { urls } from 'scenes/urls'

import { useMocks } from '~/mocks/jest'
import { initKeaTests } from '~/test/init'
import { mockEventDefinitions, mockEventPropertyDefinition } from '~/test/mocks'

describe('definitionLogic', () => {
    let logic: ReturnType<typeof definitionLogic.build>

    beforeEach(() => {
        useMocks({
            get: {
                '/api/projects/:team/event_definitions/:id': mockEventDefinitions[0],
                '/api/projects/:team/event_definitions/:id/metrics/': {},
                '/api/projects/:team/object_media_previews': { results: [] },
                '/api/projects/:team/property_definitions/:id': mockEventPropertyDefinition,
                '/api/projects/:team/property_definitions/:id/events/': {
                    count: 1,
                    results: [
                        { id: mockEventDefinitions[0].id, name: mockEventDefinitions[0].name, last_seen_at: null },
                    ],
                },
            },
        })
        initKeaTests()
    })

    describe('event definition', () => {
        it('load definition on mount', async () => {
            router.actions.push(urls.eventDefinition('1'))
            logic = definitionLogic({ id: '1' })
            logic.mount()
            await expectLogic(logic).toDispatchActions(['loadDefinition', 'loadDefinitionSuccess']).toMatchValues({
                definition: mockEventDefinitions[0],
            })
        })

        it('load new definition on mount', async () => {
            router.actions.push(urls.eventDefinition('new'))
            logic = definitionLogic({ id: 'new' })
            logic.mount()
            await expectLogic(logic)
                .toDispatchActions(['setDefinition', 'setDefinitionSuccess'])
                .toNotHaveDispatchedActions(['loadDefinition'])
                .toMatchValues({
                    definition: createNewDefinition(true),
                })
        })
    })

    describe('event property definition', () => {
        it('load definition on mount', async () => {
            router.actions.push(urls.propertyDefinition('1'))
            logic = definitionLogic({ id: '1' })
            logic.mount()
            await expectLogic(logic)
                .toDispatchActions([
                    'loadDefinition',
                    'loadDefinitionSuccess',
                    'setPropertyUsageEventsPage',
                    'loadPropertyUsageEvents',
                    'loadPropertyUsageEventsSuccess',
                ])
                .toMatchValues({
                    definition: mockEventPropertyDefinition,
                    propertyUsageEvents: {
                        count: 1,
                        results: [
                            { id: mockEventDefinitions[0].id, name: mockEventDefinitions[0].name, last_seen_at: null },
                        ],
                    },
                    propertyUsageEventsPage: 1,
                })
        })

        it('load new definition on mount', async () => {
            router.actions.push(urls.propertyDefinition('new'))
            logic = definitionLogic({ id: 'new' })
            logic.mount()
            await expectLogic(logic)
                .toDispatchActions(['setDefinition', 'setDefinitionSuccess'])
                .toNotHaveDispatchedActions(['loadDefinition'])
                .toMatchValues({
                    definition: createNewDefinition(false),
                })
        })
    })
})
