import { actions, afterMount, connect, kea, key, listeners, path, props, reducers, selectors } from 'kea'
import { loaders } from 'kea-loaders'
import { router } from 'kea-router'

import api from 'lib/api'
import { TaxonomicFilterGroupType } from 'lib/components/TaxonomicFilter/types'
import { lemonToast } from 'lib/lemon-ui/LemonToast/LemonToast'
import { Scene } from 'scenes/sceneTypes'
import { teamLogic } from 'scenes/teamLogic'
import { urls } from 'scenes/urls'

import { propertyDefinitionsEventsRetrieve } from '~/generated/core/api'
import type { PropertyDefinitionEventUsageResponseApi } from '~/generated/core/api.schemas'
import { updatePropertyDefinitions } from '~/models/propertyDefinitionsModel'
import { getFilterLabel } from '~/taxonomy/helpers'
import { Breadcrumb, Definition, EventDefinitionMetrics, ObjectMediaPreview, PropertyDefinition } from '~/types'

import { DataManagementTab } from '../DataManagementScene'
import { eventDefinitionsTableLogic } from '../events/eventDefinitionsTableLogic'
import { propertyDefinitionsTableLogic } from '../properties/propertyDefinitionsTableLogic'
import type { definitionLogicType } from './definitionLogicType'

export const PROPERTY_USAGE_EVENTS_PER_PAGE = 100

export const createNewDefinition = (isEvent: boolean): Definition => ({
    id: 'new',
    name: `New ${isEvent ? 'Event' : 'Event property'}`,
    verified: false,
    hidden: false,
})

export interface SetDefinitionProps {
    merge?: boolean
}

export interface DefinitionLogicProps {
    id?: Definition['id']
}

export const definitionLogic = kea<definitionLogicType>([
    path(['scenes', 'data-management', 'definition', 'definitionViewLogic']),
    props({} as DefinitionLogicProps),
    key((props) => props.id || 'new'),
    connect(() => ({
        values: [teamLogic, ['currentProjectId']],
    })),
    actions({
        setDefinition: (definition: Partial<Definition>, options: SetDefinitionProps = {}) => ({ definition, options }),
        loadDefinition: (id: Definition['id']) => ({ id }),
        loadMetrics: (id: Definition['id']) => ({ id }),
        loadPropertyUsageEvents: (id: Definition['id'], page = 1) => ({ id, page }),
        setPropertyUsageEventsPage: (page: number) => ({ page }),
        setDefinitionMissing: true,
        loadPreviews: true,
        createMediaPreview: (uploadedMediaId: string, metadata?: Record<string, any>) => ({
            uploadedMediaId,
            metadata,
        }),
        deleteMediaPreview: (previewId: string) => ({ previewId }),
    }),
    reducers(() => ({
        definitionMissing: [
            false,
            {
                setDefinitionMissing: () => true,
            },
        ],
        propertyUsageEventsPage: [
            1,
            {
                setPropertyUsageEventsPage: (_, { page }) => page,
            },
        ],
    })),
    loaders(({ values, actions }) => ({
        definition: [
            createNewDefinition(values.isEvent),
            {
                setDefinition: ({ definition, options: { merge } }) =>
                    (merge ? { ...values.definition, ...definition } : definition) as Definition,
                loadDefinition: async ({ id }, breakpoint) => {
                    let definition = { ...values.definition }
                    try {
                        if (values.isEvent) {
                            // Event Definition
                            definition = await api.eventDefinitions.get({
                                eventDefinitionId: id,
                            })
                        } else {
                            // Event Property Definition
                            definition = await api.propertyDefinitions.get({
                                propertyDefinitionId: id,
                            })
                            updatePropertyDefinitions({
                                [`event/${definition.name}`]: definition as PropertyDefinition,
                            })
                        }
                        breakpoint()
                    } catch (response: any) {
                        actions.setDefinitionMissing()
                        throw response
                    }

                    return definition
                },
                deleteDefinition: async () => {
                    if (values.isEvent) {
                        await api.eventDefinitions.delete({ eventDefinitionId: values.definition.id })
                    } else {
                        await api.propertyDefinitions.delete({ propertyDefinitionId: values.definition.id })
                    }
                    router.actions.push(values.isEvent ? urls.eventDefinitions() : urls.propertyDefinitions())
                    if (values.isEvent) {
                        eventDefinitionsTableLogic.findMounted()?.actions.loadEventDefinitions()
                    } else {
                        propertyDefinitionsTableLogic.findMounted()?.actions.loadPropertyDefinitions()
                    }
                    return values.definition
                },
            },
        ],
        metrics: [
            null as EventDefinitionMetrics | null,
            {
                loadMetrics: async ({ id }) => {
                    if (values.isEvent) {
                        return await api.eventDefinitions.getMetrics({ eventDefinitionId: id })
                    }

                    // For properties, we currently don't have metrics in the same way as events.
                    return null
                },
            },
        ],
        propertyUsageEvents: [
            { count: 0, results: [] } as PropertyDefinitionEventUsageResponseApi,
            {
                loadPropertyUsageEvents: async ({ id, page }) => {
                    if (values.isEvent || !id || id === 'new') {
                        return { count: 0, results: [] }
                    }

                    return await propertyDefinitionsEventsRetrieve(String(values.currentProjectId), String(id), {
                        limit: PROPERTY_USAGE_EVENTS_PER_PAGE,
                        offset: (page - 1) * PROPERTY_USAGE_EVENTS_PER_PAGE,
                    })
                },
            },
        ],
        previews: [
            [] as ObjectMediaPreview[],
            {
                loadPreviews: async () => {
                    if (!values.isEvent || !values.definition.id || values.definition.id === 'new') {
                        return []
                    }
                    try {
                        const response = await api.objectMediaPreviews.list(values.definition.id)
                        return response.results
                    } catch {
                        return []
                    }
                },
                createMediaPreview: async ({ uploadedMediaId, metadata }) => {
                    const preview = await api.objectMediaPreviews.create({
                        uploaded_media_id: uploadedMediaId,
                        event_definition_id: values.definition.id,
                        metadata,
                    })
                    return [preview, ...values.previews]
                },
                deleteMediaPreview: async ({ previewId }) => {
                    await api.objectMediaPreviews.delete(previewId)
                    return values.previews.filter((p) => p.id !== previewId)
                },
            },
        ],
    })),
    selectors({
        isEvent: [() => [router.selectors.location], ({ pathname }) => pathname.includes(urls.eventDefinitions())],
        isProperty: [(s) => [s.isEvent], (isEvent) => !isEvent],
        singular: [(s) => [s.isEvent], (isEvent): string => (isEvent ? 'event' : 'property')],
        breadcrumbs: [
            (s) => [s.definition, s.isEvent],
            (definition, isEvent): Breadcrumb[] => {
                return [
                    {
                        key: Scene.DataManagement,
                        name: `Data management`,
                        path: isEvent ? urls.eventDefinitions() : urls.propertyDefinitions(),
                        iconType: 'event_definition',
                    },
                    {
                        key: isEvent ? DataManagementTab.EventDefinitions : DataManagementTab.PropertyDefinitions,
                        name: isEvent ? 'Events' : 'Properties',
                        path: isEvent ? urls.eventDefinitions() : urls.propertyDefinitions(),
                        iconType: isEvent ? 'event_definition' : 'property_definition',
                    },
                    {
                        key: [isEvent ? Scene.EventDefinition : Scene.PropertyDefinition, definition?.id || 'new'],
                        name:
                            definition?.id !== 'new'
                                ? getFilterLabel(
                                      definition?.name,
                                      isEvent
                                          ? TaxonomicFilterGroupType.Events
                                          : TaxonomicFilterGroupType.EventProperties
                                  ) || 'Untitled'
                                : 'Untitled',
                        iconType: isEvent ? 'event_definition' : 'property_definition',
                    },
                ]
            },
        ],
    }),
    listeners(({ actions, values }) => ({
        loadDefinitionSuccess: () => {
            if (values.isEvent && values.definition.id && values.definition.id !== 'new') {
                actions.loadPreviews()
            } else if (values.isProperty && values.definition.id && values.definition.id !== 'new') {
                actions.setPropertyUsageEventsPage(1)
            }
        },
        setPropertyUsageEventsPage: ({ page }) => {
            if (values.isProperty && values.definition.id && values.definition.id !== 'new') {
                actions.loadPropertyUsageEvents(values.definition.id, page)
            }
        },
        createMediaPreviewSuccess: () => {
            lemonToast.success('Preview image added')
        },
        createMediaPreviewFailure: () => {
            lemonToast.error('Failed to add image')
        },
        deleteMediaPreviewSuccess: () => {
            lemonToast.success('Image deleted')
        },
        deleteMediaPreviewFailure: () => {
            lemonToast.error('Failed to delete image')
        },
    })),
    afterMount(({ actions, values, props }) => {
        if (!props.id || props.id === 'new') {
            actions.setDefinition(createNewDefinition(values.isEvent))
        } else {
            actions.loadDefinition(props.id)
            actions.loadMetrics(props.id)
        }
    }),
])
