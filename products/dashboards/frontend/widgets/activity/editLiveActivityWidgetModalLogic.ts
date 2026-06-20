import { actions, connect, defaults, kea, listeners, path, props, reducers, selectors } from 'kea'

import { filterTestAccountsDefaultsLogic } from 'scenes/settings/environment/filterTestAccountDefaultsLogic'

import type { LiveActivityWidgetConfig } from '../../generated/widget-configs.zod'
import { isWidgetConfigValidationError } from '../../utils'
import { resolveWidgetFilterTestAccounts } from '../../widget_types/widgetConfigShared'
import {
    buildWidgetTileMetadataPatch,
    getWidgetEditModalTileDefaults,
    widgetEditModalFilterTestAccountsActions,
    widgetEditModalListFieldActions,
    widgetEditModalPropSelectors,
    widgetEditModalTileActions,
} from '../editWidgetModalBuilders'
import type { DashboardWidgetEditModalProps } from '../registry'
import type { editLiveActivityWidgetModalLogicType } from './editLiveActivityWidgetModalLogicType'
import {
    parseLiveActivityWidgetConfig,
    validateLiveActivityWidgetConfigInput,
    type LiveActivityWidgetFieldErrors,
} from './liveActivityWidgetConfigValidation'

export type EditLiveActivityWidgetModalLogicProps = Omit<DashboardWidgetEditModalProps, 'isOpen'>

export const editLiveActivityWidgetModalLogic = kea<editLiveActivityWidgetModalLogicType>([
    path(['products', 'dashboards', 'widgets', 'activity', 'editLiveActivityWidgetModalLogic']),

    props({
        config: {},
        onSave: async () => {},
        onClose: () => {},
        name: '',
        defaultTitle: 'Untitled',
        description: '',
    } as EditLiveActivityWidgetModalLogicProps),

    connect(() => ({
        values: [filterTestAccountsDefaultsLogic, ['filterTestAccountsDefault']],
    })),

    actions({
        ...widgetEditModalListFieldActions,
        ...widgetEditModalTileActions,
        ...widgetEditModalFilterTestAccountsActions,
        setRefreshIntervalSeconds: (refreshIntervalSeconds: number) => ({ refreshIntervalSeconds }),
        setFieldErrors: (fieldErrors: LiveActivityWidgetFieldErrors) => ({ fieldErrors }),
        clearFieldError: (field: keyof LiveActivityWidgetFieldErrors) => ({ field }),
        submit: true,
        submitSuccess: true,
        submitFailure: true,
    }),

    reducers({
        limit: [
            5,
            {
                setLimit: (_: number, { limit }: { limit: number }) => limit,
            },
        ],
        refreshIntervalSeconds: [
            15,
            {
                setRefreshIntervalSeconds: (
                    _: number,
                    { refreshIntervalSeconds }: { refreshIntervalSeconds: number }
                ) => refreshIntervalSeconds,
            },
        ],
        tileName: [
            '',
            {
                setTileName: (_: string, { tileName }: { tileName: string }) => tileName,
            },
        ],
        tileDescription: [
            '',
            {
                setTileDescription: (_: string, { tileDescription }: { tileDescription: string }) => tileDescription,
            },
        ],
        filterTestAccounts: [
            false,
            {
                setFilterTestAccounts: (_: boolean, { filterTestAccounts }: { filterTestAccounts: boolean }) =>
                    filterTestAccounts,
            },
        ],
        fieldErrors: [
            {} as LiveActivityWidgetFieldErrors,
            {
                setFieldErrors: (
                    _: LiveActivityWidgetFieldErrors,
                    { fieldErrors }: { fieldErrors: LiveActivityWidgetFieldErrors }
                ) => fieldErrors,
                clearFieldError: (
                    state: LiveActivityWidgetFieldErrors,
                    { field }: { field: keyof LiveActivityWidgetFieldErrors }
                ) => {
                    if (!state[field]) {
                        return state
                    }
                    const next = { ...state }
                    delete next[field]
                    return next
                },
            },
        ],
        saving: [
            false,
            {
                submit: (_state: boolean, _payload: { value: true }) => true,
                submitSuccess: (_state: boolean, _payload: { value: true }) => false,
                submitFailure: (_state: boolean, _payload: { value: true }) => false,
            },
        ],
    }),

    selectors({
        widgetConfig: [
            (_, p) => [p.config],
            (config): LiveActivityWidgetConfig => parseLiveActivityWidgetConfig(config),
        ],
        ...widgetEditModalPropSelectors,
        validation: [
            (s) => [s.limit, s.refreshIntervalSeconds, s.filterTestAccounts, s.widgetConfig],
            (limit, refreshIntervalSeconds, filterTestAccounts, widgetConfig) =>
                validateLiveActivityWidgetConfigInput({
                    limit,
                    refreshIntervalSeconds,
                    filterTestAccounts,
                    baseConfig: widgetConfig,
                }),
        ],
        activeFieldErrors: [
            (s) => [s.validation, s.fieldErrors],
            (validation, fieldErrors): LiveActivityWidgetFieldErrors => {
                if (!validation.success) {
                    return { ...validation.fieldErrors, ...fieldErrors }
                }
                return fieldErrors
            },
        ],
        saveDisabledReason: [
            (s) => [s.saving, s.validation],
            (saving, validation): string | undefined => {
                if (saving) {
                    return 'Saving…'
                }
                if (!validation.success) {
                    return 'Fix validation errors to save'
                }
                return undefined
            },
        ],
    }),

    defaults(({ props, values }) => {
        const baseConfig = parseLiveActivityWidgetConfig(props.config)

        return {
            limit: baseConfig.limit,
            refreshIntervalSeconds: baseConfig.refreshIntervalSeconds,
            ...getWidgetEditModalTileDefaults(props),
            filterTestAccounts: resolveWidgetFilterTestAccounts(
                baseConfig.filterTestAccounts,
                values.filterTestAccountsDefault
            ),
            fieldErrors: {},
            saving: false,
        }
    }),

    listeners(({ actions, props, values }) => ({
        submit: async () => {
            const result = values.validation

            if (!result.success) {
                actions.setFieldErrors(result.fieldErrors)
                return
            }

            try {
                await props.onSave(
                    result.config,
                    buildWidgetTileMetadataPatch(props, values.tileName, values.tileDescription)
                )
                actions.setFieldErrors({})
                props.onClose()
                actions.submitSuccess()
            } catch (error) {
                actions.submitFailure()
                if (isWidgetConfigValidationError(error)) {
                    actions.setFieldErrors(error.fieldErrors as LiveActivityWidgetFieldErrors)
                    return
                }
                throw error
            }
        },
    })),
])
