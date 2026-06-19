import { connect, kea, key, listeners, path, props } from 'kea'
import { forms } from 'kea-forms'
import posthog from 'posthog-js'

import { lemonToast } from '@posthog/lemon-ui'

import { dashboardsModel } from '~/models/dashboardsModel'
import { DashboardTile, DashboardType, QueryBasedInsightModel } from '~/types'

import type { textCardModalLogicType } from './textCardModalLogicType'
import {
    DashboardTextTileKind,
    DEFAULT_DASHBOARD_SECTION_HEADER_TITLE,
    getDashboardSectionHeaderMarkdown,
    getDashboardSectionHeaderTitle,
    getDashboardTextTileKind,
} from './textCardUtils'

export interface TextTileForm {
    body: string
    transparent_background: boolean
}

export interface TextCardModalProps {
    dashboard: DashboardType<QueryBasedInsightModel>
    textTileId: number | 'new'
    onClose: () => void
    textTileKind?: DashboardTextTileKind
    defaultLayouts?: DashboardTile<QueryBasedInsightModel>['layouts']
}

const MAX_TEXT_CARD_BODY_LENGTH = 4000

const resolveTextTileKind = (props: TextCardModalProps): DashboardTextTileKind => {
    const tile = props.textTileId !== 'new' ? props.dashboard.tiles?.find((tt) => tt.id === props.textTileId) : null
    return getDashboardTextTileKind(tile, props.textTileKind ?? 'text')
}

const getExistingTextTile = (
    dashboard: DashboardType<QueryBasedInsightModel>,
    textTileId: number,
    textTileKind: DashboardTextTileKind
): TextTileForm => {
    const tile = dashboard.tiles?.find((tt) => tt.id === textTileId)
    const body = tile?.text?.body || ''
    return {
        body: textTileKind === 'section' ? (getDashboardSectionHeaderTitle(body) ?? body) : body,
        transparent_background: textTileKind === 'section' ? true : (tile?.transparent_background ?? false),
    }
}

export const textCardModalLogic = kea<textCardModalLogicType>([
    path(['scenes', 'dashboard', 'dashboardTextTileModal', 'logic']),
    props({} as TextCardModalProps),
    key((props) => `textCardModalLogic-${props.dashboard.id}-${props.textTileId}-${resolveTextTileKind(props)}`),
    connect(() => ({ actions: [dashboardsModel, ['updateDashboard']] })),
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
                const apiBodyError =
                    (Array.isArray(normalizedErrors?.body) ? normalizedErrors.body[0] : normalizedErrors?.body) ||
                    (Array.isArray(normalizedErrors?.text?.body)
                        ? normalizedErrors.text.body[0]
                        : normalizedErrors?.text?.body) ||
                    null

                // Expected validation errors are shown inline on the form.
                if (formBodyError || apiBodyError) {
                    return
                }

                lemonToast.error(`Could not save text: ${normalizedMessage}`)
            }
        },
        submitTextTileSuccess: ({ textTile }: { textTile: TextTileForm }) => {
            const textTileKind = resolveTextTileKind(props)
            actions.resetTextTile()
            props?.onClose?.()

            posthog.capture('dashboard text tile saved', {
                dashboard_id: props.dashboard.id,
                text_tile_id: props.textTileId === 'new' ? null : props.textTileId,
                is_new: props.textTileId === 'new',
                body_length: textTile.body.length,
                text_tile_kind: textTileKind,
            })

            if (textTileKind === 'section' && props.textTileId === 'new') {
                posthog.capture('dashboard section header added', {
                    dashboard_id: props.dashboard.id,
                    title_length: textTile.body.trim().length,
                })
            }
        },
    })),
    forms(({ props, actions }) => ({
        textTile: {
            defaults: (() => {
                const textTileKind = resolveTextTileKind(props)
                return (
                    props.textTileId && props.textTileId !== 'new'
                        ? getExistingTextTile(props.dashboard, props.textTileId, textTileKind)
                        : {
                              body: textTileKind === 'section' ? DEFAULT_DASHBOARD_SECTION_HEADER_TITLE : '',
                              transparent_background: textTileKind === 'section',
                          }
                ) as TextTileForm
            })(),
            errors: ({ body }) => {
                const textTileKind = resolveTextTileKind(props)
                const storedBodyLength =
                    textTileKind === 'section' ? getDashboardSectionHeaderMarkdown(body).length : body.length
                return {
                    body: !body.trim()
                        ? textTileKind === 'section'
                            ? 'Add a section title'
                            : 'This card would be empty! Type something first'
                        : storedBodyLength > MAX_TEXT_CARD_BODY_LENGTH
                          ? `Text is too long (${MAX_TEXT_CARD_BODY_LENGTH} characters max)`
                          : null,
                }
            },
            submit: (formValues) => {
                const textTileKind = resolveTextTileKind(props)
                const body =
                    textTileKind === 'section' ? getDashboardSectionHeaderMarkdown(formValues.body) : formValues.body
                const transparentBackground = textTileKind === 'section' ? true : formValues.transparent_background
                // only id and body, layout and color could be out-of-date
                const textTiles = (props.dashboard.tiles || []).map((t) => ({
                    id: t.id,
                    text: t.text,
                    transparent_background: t.transparent_background,
                }))

                if (props.textTileId === 'new') {
                    actions.updateDashboard({
                        id: props.dashboard.id,
                        tiles: [
                            {
                                text: { body },
                                transparent_background: transparentBackground,
                                ...(textTileKind === 'section' && props.defaultLayouts
                                    ? { layouts: props.defaultLayouts }
                                    : {}),
                            },
                        ],
                    })
                } else {
                    const updatedTiles = [...textTiles].reduce((acc, tile) => {
                        if (tile.id === props.textTileId && tile.text) {
                            tile.text.body = body
                            ;(tile as Partial<DashboardTile>).transparent_background = transparentBackground
                            acc.push(tile)
                        }
                        return acc
                    }, [] as Partial<DashboardTile>[])
                    actions.updateDashboard({ id: props.dashboard.id, tiles: updatedTiles })
                }
            },
        },
    })),
])
