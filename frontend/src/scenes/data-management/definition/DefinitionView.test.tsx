import '@testing-library/jest-dom'

import { cleanup, render, screen } from '@testing-library/react'
import { router } from 'kea-router'

import { urls } from 'scenes/urls'

import { useMocks } from '~/mocks/jest'
import { initKeaTests } from '~/test/init'
import { mockEventPropertyDefinition } from '~/test/mocks'

import { DefinitionView } from './DefinitionView'

const propertyEventsResponse = {
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

describe('DefinitionView property event usage', () => {
    beforeEach(() => {
        useMocks({
            get: {
                '/api/projects/:team/property_definitions/:id': mockEventPropertyDefinition,
                '/api/projects/:team/property_definitions/:id/events/': propertyEventsResponse,
            },
        })
        initKeaTests()
        router.actions.push(urls.propertyDefinition('1'))
    })

    afterEach(() => {
        cleanup()
    })

    it('renders events that use the property with links to event definitions', async () => {
        render(<DefinitionView id="1" />)

        expect(await screen.findByText('Events using this property')).toBeInTheDocument()
        expect(await screen.findByText('$pageview')).toBeInTheDocument()
        expect(
            screen.getByText((content) =>
                content.includes('2 current event definitions include this property in ingestion metadata.')
            )
        ).toBeInTheDocument()
        expect(screen.getByText(propertyEventsResponse.freshness)).toBeInTheDocument()

        const eventLink = await screen.findByRole('link', { name: '$pageview' })
        expect(eventLink).toHaveAttribute('href', expect.stringContaining(urls.eventDefinition('event-definition-1')))
        expect(screen.getByText('checkout completed')).toBeInTheDocument()
    })

    it('renders the empty state when no current event definitions use the property', async () => {
        useMocks({
            get: {
                '/api/projects/:team/property_definitions/:id': mockEventPropertyDefinition,
                '/api/projects/:team/property_definitions/:id/events/': {
                    ...propertyEventsResponse,
                    count: 0,
                    results: [],
                },
            },
        })

        render(<DefinitionView id="1" />)

        expect(
            await screen.findByText('No current event definitions are known to use this property')
        ).toBeInTheDocument()
    })

    it('renders an error state when event usage fails to load', async () => {
        useMocks({
            get: {
                '/api/projects/:team/property_definitions/:id': mockEventPropertyDefinition,
                '/api/projects/:team/property_definitions/:id/events/': () => [500, { detail: 'Server error' }],
            },
        })

        render(<DefinitionView id="1" />)

        expect(await screen.findByText('Failed to load events that use this property.')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    })
})
