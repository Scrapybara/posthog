import { router } from 'kea-router'
import { expectLogic } from 'kea-test-utils'

import { createNewDefinition, definitionLogic } from 'scenes/data-management/definition/definitionLogic'
import { urls } from 'scenes/urls'

import { useMocks } from '~/mocks/jest'
import { initKeaTests } from '~/test/init'
import { mockEventDefinitions, mockEventPropertyDefinition } from '~/test/mocks'

const mockPropertyEventsResponse = {
    count: 2,
    next: null,
    previous: null,
    results: [
        {
            id: 'event-definition-1',
            name: '$pageview',
            last_seen_at: '2026-06-01T12:00:00Z',
        },
        {
            id: 'event-definition-2',
            name: 'checkout completed',
            last_seen_at: null,
        },
    ],
    source: 'event_property_metadata',
    freshness:
        'Updated asynchronously from ingestion metadata. Rows mean this property has been seen on the event at least once; deleted event definitions are omitted.',
}

describe('definitionLogic', () => {
    let logic: ReturnType<typeof definitionLogic.build>

    beforeEach(() => {
        useMocks({
            get: {
                '/api/projects/:team/event_definitions/:id': mockEventDefinitions[0],
                '/api/projects/:team/event_definitions/:id/metrics/': { query_usage_30_day: 0 },
                '/api/projects/:team/object_media_previews': { results: [] },
                '/api/projects/:team/property_definitions/:id': mockEventPropertyDefinition,
                '/api/projects/:team/property_definitions/:id/events/': mockPropertyEventsResponse,
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
                    'loadPropertyEvents',
                    'loadPropertyEventsSuccess',
                ])
                .toMatchValues({
                    definition: mockEventPropertyDefinition,
                    propertyEvents: mockPropertyEventsResponse,
                    propertyEventsLoadFailed: false,
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

        it('loads paginated property event usage', async () => {
            let requestedOffset: string | null = null
            useMocks({
                get: {
                    '/api/projects/:team/event_definitions/:id': mockEventDefinitions[0],
                    '/api/projects/:team/property_definitions/:id': mockEventPropertyDefinition,
                    '/api/projects/:team/property_definitions/:id/events/': (req) => {
                        requestedOffset = req.url.searchParams.get('offset')
                        return [
                            200,
                            {
                                ...mockPropertyEventsResponse,
                                next: null,
                                previous: '/api/projects/1/property_definitions/1/events/?limit=10&offset=0',
                                results: [mockPropertyEventsResponse.results[1]],
                            },
                        ]
                    },
                },
            })
            router.actions.push(urls.propertyDefinition('1'))
            logic = definitionLogic({ id: '1' })
            logic.mount()
            await expectLogic(logic).toDispatchActions(['loadPropertyEventsSuccess'])
            requestedOffset = null

            await expectLogic(logic, () => {
                logic.actions.loadPropertyEvents('1', 10)
            })
                .toDispatchActions(['loadPropertyEvents', 'loadPropertyEventsSuccess'])
                .toMatchValues({
                    propertyEventsOffset: 10,
                    propertyEventsPreviousOffset: 0,
                    propertyEventsNextOffset: null,
                })

            expect(requestedOffset).toBe('10')
        })

        it('tracks property event usage load failures', async () => {
            useMocks({
                get: {
                    '/api/projects/:team/event_definitions/:id': mockEventDefinitions[0],
                    '/api/projects/:team/property_definitions/:id': mockEventPropertyDefinition,
                    '/api/projects/:team/property_definitions/:id/events/': () => [500, { detail: 'Server error' }],
                },
            })
            router.actions.push(urls.propertyDefinition('1'))
            logic = definitionLogic({ id: '1' })
            logic.mount()

            await expectLogic(logic)
                .toDispatchActions(['loadPropertyEventsFailure'])
                .toMatchValues({ propertyEventsLoadFailed: true })
        })
    })
})
