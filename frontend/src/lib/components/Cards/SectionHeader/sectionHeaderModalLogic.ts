import { connect, kea, key, listeners, path, props } from 'kea'
import { forms } from 'kea-forms'
import posthog from 'posthog-js'

import { lemonToast } from '@posthog/lemon-ui'

import {
    composeSectionHeaderBody,
    parseSectionHeaderBody,
    SECTION_HEADER_MAX_DESCRIPTION_LENGTH,
    SECTION_HEADER_MAX_TITLE_LENGTH,
} from 'lib/components/Cards/SectionHeader/sectionHeaderMarkdown'

import { dashboardsModel } from '~/models/dashboardsModel'
import { DashboardTile, DashboardType, QueryBasedInsightModel } from '~/types'

import type { sectionHeaderModalLogicType } from './sectionHeaderModalLogicType'

export interface SectionHeaderForm {
    title: string
    description: string
}

export interface SectionHeaderModalProps {
    dashboard: DashboardType<QueryBasedInsightModel>
    sectionHeaderId: number | 'new'
    onClose: () => void
}

/** Full width on the 12-column desktop grid; two rows so the title, description, and divider all show. */
export const SECTION_HEADER_DEFAULT_WIDTH = 12
export const SECTION_HEADER_DEFAULT_HEIGHT = 2

export interface SectionHeaderLayouts {
    sm: { x: number; y: number; w: number; h: number }
    xs: { x: number; y: number; w: number; h: number }
}

const EMPTY_FORM: SectionHeaderForm = { title: '', description: '' }

const getExistingSectionHeader = (
    dashboard: DashboardType<QueryBasedInsightModel>,
    sectionHeaderId: number
): SectionHeaderForm => {
    const tile = dashboard.tiles?.find((tt) => tt.id === sectionHeaderId)
    return parseSectionHeaderBody(tile?.text?.body) ?? EMPTY_FORM
}

/** Place a new full-width section header on a fresh row beneath every existing tile. */
export const sectionHeaderDefaultLayouts = (
    tiles: { layouts?: DashboardTile<QueryBasedInsightModel>['layouts'] }[] | null | undefined
): SectionHeaderLayouts => {
    let maxBottom = 0
    for (const tile of tiles || []) {
        const sm = tile.layouts?.sm
        if (sm && typeof sm.y === 'number' && typeof sm.h === 'number') {
            maxBottom = Math.max(maxBottom, sm.y + sm.h)
        }
    }
    return {
        sm: { x: 0, y: maxBottom, w: SECTION_HEADER_DEFAULT_WIDTH, h: SECTION_HEADER_DEFAULT_HEIGHT },
        xs: { x: 0, y: maxBottom, w: 1, h: SECTION_HEADER_DEFAULT_HEIGHT },
    }
}

export const sectionHeaderModalLogic = kea<sectionHeaderModalLogicType>([
    path(['scenes', 'dashboard', 'sectionHeaderModal', 'logic']),
    props({} as SectionHeaderModalProps),
    key((props) => `sectionHeaderModalLogic-${props.dashboard.id}-${props.sectionHeaderId}`),
    connect(() => ({ actions: [dashboardsModel, ['updateDashboard']] })),
    listeners(({ props }) => ({
        submitSectionHeaderFailure: ({ error }: { error?: any }) => {
            const message =
                (typeof error === 'string' && error) ||
                (error && typeof error === 'object' && typeof error.error === 'string' && error.error) ||
                'Unknown error'
            lemonToast.error(`Could not save section header: ${message}`)
        },
        submitSectionHeaderSuccess: ({ sectionHeader }: { sectionHeader: SectionHeaderForm }) => {
            props?.onClose?.()

            posthog.capture('dashboard section header saved', {
                dashboard_id: props.dashboard.id,
                section_header_tile_id: props.sectionHeaderId === 'new' ? null : props.sectionHeaderId,
                is_new: props.sectionHeaderId === 'new',
                title_length: sectionHeader.title.trim().length,
                has_description: !!sectionHeader.description.trim(),
            })
        },
    })),
    forms(({ props, actions }) => ({
        sectionHeader: {
            defaults: (props.sectionHeaderId && props.sectionHeaderId !== 'new'
                ? getExistingSectionHeader(props.dashboard, props.sectionHeaderId)
                : EMPTY_FORM) as SectionHeaderForm,
            errors: ({ title, description }) => ({
                title: !title.trim()
                    ? 'Give the section a title'
                    : title.trim().length > SECTION_HEADER_MAX_TITLE_LENGTH
                      ? `Title is too long (${SECTION_HEADER_MAX_TITLE_LENGTH} characters max)`
                      : null,
                description:
                    description.trim().length > SECTION_HEADER_MAX_DESCRIPTION_LENGTH
                        ? `Description is too long (${SECTION_HEADER_MAX_DESCRIPTION_LENGTH} characters max)`
                        : null,
            }),
            submit: (formValues) => {
                const body = composeSectionHeaderBody(formValues)

                if (props.sectionHeaderId === 'new') {
                    actions.updateDashboard({
                        id: props.dashboard.id,
                        tiles: [
                            {
                                text: { body },
                                transparent_background: true,
                                layouts: sectionHeaderDefaultLayouts(props.dashboard.tiles),
                            },
                        ],
                    })
                    return
                }

                const existingTile = (props.dashboard.tiles || []).find((t) => t.id === props.sectionHeaderId)
                if (!existingTile?.text) {
                    return
                }
                actions.updateDashboard({
                    id: props.dashboard.id,
                    tiles: [
                        {
                            id: existingTile.id,
                            text: { ...existingTile.text, body },
                            transparent_background: true,
                        } as Partial<DashboardTile>,
                    ],
                })
            },
        },
    })),
])
