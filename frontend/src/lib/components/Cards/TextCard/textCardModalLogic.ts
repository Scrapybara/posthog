import { connect, kea, key, listeners, path, props } from 'kea'
import { forms } from 'kea-forms'
import posthog from 'posthog-js'

import { lemonToast } from '@posthog/lemon-ui'
import {
    dashboardsCreateTextTileCreate,
    dashboardsUpdateTextTileCreate,
} from '@posthog/products-dashboards/frontend/generated/api'

import { dashboardLogic } from 'scenes/dashboard/dashboardLogic'
import { teamLogic } from 'scenes/teamLogic'

import { dashboardsModel } from '~/models/dashboardsModel'
import { DashboardTile, DashboardType, QueryBasedInsightModel } from '~/types'

import type { textCardModalLogicType } from './textCardModalLogicType'
import {
    buildDashboardSectionHeaderBody,
    defaultSectionHeaderLayoutAtBottom,
    isDashboardSectionHeaderTile,
    parseDashboardSectionHeaderBody,
    SECTION_HEADER_MAX_DESCRIPTION_LENGTH,
    SECTION_HEADER_MAX_TITLE_LENGTH,
} from './textCardSectionHeader'

export type TextCardModalKind = 'text' | 'section'

export interface TextTileForm {
    body: string
    title: string
    description: string
    transparent_background: boolean
}

export interface TextCardModalProps {
    dashboard: DashboardType<QueryBasedInsightModel>
    textTileId: number | 'new'
    onClose: () => void
    kind?: TextCardModalKind
    smLayouts?: ReadonlyArray<{ y?: number; h?: number }>
}

const MAX_TEXT_CARD_BODY_LENGTH = 4000

const getExistingTextTile = (dashboard: DashboardType<QueryBasedInsightModel>, textTileId: number): TextTileForm => {
    const tile = dashboard.tiles?.find((tt) => tt.id === textTileId)
    const sectionHeader = parseDashboardSectionHeaderBody(tile?.text?.body)
    return {
        body: tile?.text?.body || '',
        title: sectionHeader?.title || '',
        description: sectionHeader?.description || '',
        transparent_background: tile?.transparent_background ?? false,
    }
}

const NEW_TEXT_TILE_DEFAULTS: TextTileForm = {
    body: '',
    title: '',
    description: '',
    transparent_background: false,
}

const NEW_SECTION_HEADER_DEFAULTS: TextTileForm = {
    body: '',
    title: '',
    description: '',
    transparent_background: true,
}

function mergeSavedTextTileIntoDashboard(
    dashboard: DashboardType<QueryBasedInsightModel>,
    savedTile: DashboardTile<QueryBasedInsightModel>,
    isNew: boolean
): DashboardType<QueryBasedInsightModel> {
    return {
        ...dashboard,
        tiles: isNew
            ? [...(dashboard.tiles || []), savedTile]
            : (dashboard.tiles || []).map((tile) => (tile.id === savedTile.id ? savedTile : tile)),
    }
}

function getSubmitBody(kind: TextCardModalKind, formValues: TextTileForm): string {
    return kind === 'section'
        ? buildDashboardSectionHeaderBody({
              title: formValues.title,
              description: formValues.description,
          })
        : formValues.body
}

export const textCardModalLogic = kea<textCardModalLogicType>([
    path(['scenes', 'dashboard', 'dashboardTextTileModal', 'logic']),
    props({} as TextCardModalProps),
    key((props) => `textCardModalLogic-${props.dashboard.id}-${props.textTileId}-${props.kind ?? 'text'}`),
    connect((props: TextCardModalProps) => ({
        actions: [
            dashboardsModel,
            ['updateDashboardSuccess'],
            dashboardLogic({ id: props.dashboard.id, dashboard: props.dashboard }),
            ['requestScrollToBottom'],
        ],
    })),
    listeners(({ props, actions, values }) => ({
        submitTextTileFailure: (error) => {
            if (props.dashboard && props.textTileId) {
                const failure = error as {
                    errors?: Record<string, any>
                    error?: string | { error?: string; errors?: Record<string, any> }
                }
                const normalizedErrors = (failure.errors ||
                    (typeof failure.error === 'object' ? failure.error?.errors : undefined) ||
                    {}) as Record<string, any>
                const normalizedMessage =
                    (typeof failure.error === 'string' ? failure.error : null) ||
                    (typeof failure.error === 'object' && typeof failure.error?.error === 'string'
                        ? failure.error.error
                        : null) ||
                    'Unknown error'
                const formBodyError = values.textTileValidationErrors.body as string | null
                const formTitleError = values.textTileValidationErrors.title as string | null
                const formDescriptionError = values.textTileValidationErrors.description as string | null
                const apiBodyError =
                    (Array.isArray(normalizedErrors?.body) ? normalizedErrors.body[0] : normalizedErrors?.body) ||
                    (Array.isArray(normalizedErrors?.text?.body)
                        ? normalizedErrors.text.body[0]
                        : normalizedErrors?.text?.body) ||
                    null

                // Expected validation errors are shown inline on the form.
                if (formBodyError || formTitleError || formDescriptionError || apiBodyError) {
                    return
                }

                lemonToast.error(`Could not save text: ${normalizedMessage}`)
            }
        },
        submitTextTileSuccess: ({ textTile }: { textTile: TextTileForm }) => {
            actions.resetTextTile()
            props?.onClose?.()

            const kind = props.kind ?? 'text'
            posthog.capture(kind === 'section' ? 'dashboard section header saved' : 'dashboard text tile saved', {
                dashboard_id: props.dashboard.id,
                text_tile_id: props.textTileId === 'new' ? null : props.textTileId,
                is_new: props.textTileId === 'new',
                body_length: getSubmitBody(kind, textTile).length,
            })
        },
    })),
    forms(({ props, actions }) => ({
        textTile: {
            defaults: (props.textTileId && props.textTileId !== 'new'
                ? getExistingTextTile(props.dashboard, props.textTileId)
                : props.kind === 'section'
                  ? NEW_SECTION_HEADER_DEFAULTS
                  : NEW_TEXT_TILE_DEFAULTS) as TextTileForm,
            errors: ({ body, title, description }) => {
                if (props.kind === 'section') {
                    return {
                        title: !title.trim()
                            ? 'Add a title first'
                            : title.length > SECTION_HEADER_MAX_TITLE_LENGTH
                              ? `Title is too long (${SECTION_HEADER_MAX_TITLE_LENGTH} characters max)`
                              : null,
                        description:
                            description.length > SECTION_HEADER_MAX_DESCRIPTION_LENGTH
                                ? `Description is too long (${SECTION_HEADER_MAX_DESCRIPTION_LENGTH} characters max)`
                                : null,
                        body: null,
                    }
                }

                return {
                    body: !body.trim()
                        ? 'This card would be empty! Type something first'
                        : body.length > MAX_TEXT_CARD_BODY_LENGTH
                          ? `Text is too long (${MAX_TEXT_CARD_BODY_LENGTH} characters max)`
                          : null,
                    title: null,
                    description: null,
                }
            },
            submit: async (formValues) => {
                const kind = props.kind ?? 'text'
                const body = getSubmitBody(kind, formValues)
                const projectId = String(teamLogic.values.currentTeamId)

                if (props.textTileId === 'new') {
                    const savedTile = (await dashboardsCreateTextTileCreate(projectId, props.dashboard.id, {
                        body,
                        transparent_background: kind === 'section' ? true : formValues.transparent_background,
                        layouts: kind === 'section' ? defaultSectionHeaderLayoutAtBottom(props.smLayouts) : undefined,
                    })) as unknown as DashboardTile<QueryBasedInsightModel>

                    actions.updateDashboardSuccess(mergeSavedTextTileIntoDashboard(props.dashboard, savedTile, true))
                    if (isDashboardSectionHeaderTile(savedTile)) {
                        actions.requestScrollToBottom()
                    }
                } else {
                    const savedTile = (await dashboardsUpdateTextTileCreate(projectId, props.dashboard.id, {
                        tile_id: props.textTileId,
                        body,
                        transparent_background: kind === 'section' ? true : formValues.transparent_background,
                    })) as unknown as DashboardTile<QueryBasedInsightModel>

                    actions.updateDashboardSuccess(mergeSavedTextTileIntoDashboard(props.dashboard, savedTile, false))
                }

                return {
                    ...formValues,
                    body,
                    transparent_background: kind === 'section' ? true : formValues.transparent_background,
                }
            },
        },
    })),
])
