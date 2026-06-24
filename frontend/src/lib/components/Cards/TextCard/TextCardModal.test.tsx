import '@testing-library/jest-dom'

import { cleanup, render } from '@testing-library/react'

import { DashboardType, QueryBasedInsightModel } from '~/types'

import { TextCardModal } from './TextCardModal'
import { buildDashboardSectionHeaderBody } from './textCardSectionHeader'

let mockValues: any
const mockResetTextTile = jest.fn()

jest.mock('kea', () => ({
    useActions: jest.fn(() => ({ resetTextTile: mockResetTextTile })),
    useValues: jest.fn(() => mockValues),
}))

jest.mock('kea-forms', () => ({
    Field: ({ children, name }: any) =>
        children({
            onChange: jest.fn(),
            value: mockValues?.textTile?.[name] ?? '',
        }),
    Form: ({ children }: any) => <form id="text-tile-form">{children}</form>,
}))

jest.mock('lib/components/Cards/TextCard/textCardModalLogic', () => ({
    textCardModalLogic: jest.fn(() => ({ __mock: 'textCardModalLogic' })),
}))

jest.mock('lib/components/Cards/TextCard/TextCardModalBodyField', () => ({
    TextCardModalBodyField: () => <textarea data-attr="text-card-body-field" />,
}))

jest.mock('lib/lemon-ui/LemonButton', () => ({
    LemonButton: ({ children, disabledReason: _disabledReason, htmlType, loading: _loading, type, ...props }: any) => (
        <button type={htmlType || (type === 'primary' || type === 'secondary' ? 'button' : type)} {...props}>
            {children}
        </button>
    ),
}))

jest.mock('lib/lemon-ui/LemonInput', () => ({
    LemonInput: ({ value, onChange, ...props }: any) => (
        <input value={value} onChange={(event) => onChange?.(event.target.value)} {...props} />
    ),
}))

jest.mock('lib/lemon-ui/LemonSwitch', () => ({
    LemonSwitch: ({ checked, label: _label, onChange, ...props }: any) => (
        <input checked={checked} onChange={(event) => onChange?.(event.target.checked)} type="checkbox" {...props} />
    ),
}))

jest.mock('lib/lemon-ui/LemonTextArea', () => ({
    LemonTextArea: ({ maxRows: _maxRows, minRows: _minRows, onChange, value, ...props }: any) => (
        <textarea value={value} onChange={(event) => onChange?.(event.target.value)} {...props} />
    ),
}))

jest.mock('lib/ui/DialogPrimitive/DialogPrimitive', () => ({
    DialogClose: () => <button type="button">Close</button>,
    DialogPrimitive: ({ children, disablePointerDismissal }: any) => (
        <div data-attr="dialog" data-disable-pointer-dismissal={String(disablePointerDismissal)}>
            {children}
        </div>
    ),
    DialogPrimitiveTitle: ({ children }: any) => <div>{children}</div>,
}))

const makeDashboard = (body: string): DashboardType<QueryBasedInsightModel> =>
    ({
        id: 1,
        tiles: [
            {
                id: 2,
                text: { body },
                layouts: {},
                transparent_background: true,
            },
        ],
    }) as DashboardType<QueryBasedInsightModel>

describe('TextCardModal', () => {
    afterEach(() => {
        cleanup()
    })

    beforeEach(() => {
        mockValues = {
            isTextTileSubmitting: false,
            textTile: { body: '', description: '', title: '', transparent_background: false },
            textTileValidationErrors: { body: null, description: null, title: null },
        }
    })

    it('recomputes dirty-state baseline when opening an existing text tile after a closed mount', () => {
        const dashboard = makeDashboard('Existing text')
        const { getByTestId, rerender } = render(
            <TextCardModal dashboard={dashboard} isOpen={false} onClose={jest.fn()} textTileId={null} />
        )

        mockValues = {
            ...mockValues,
            textTile: { body: 'Existing text', description: '', title: '', transparent_background: true },
        }
        rerender(<TextCardModal dashboard={dashboard} isOpen={true} onClose={jest.fn()} textTileId={2} />)

        expect(getByTestId('dialog')).toHaveAttribute('data-disable-pointer-dismissal', 'false')
    })

    it('recomputes dirty-state baseline when opening an existing section header after a closed mount', () => {
        const body = buildDashboardSectionHeaderBody({
            description: 'Key funnel steps',
            title: 'Activation',
        })
        const dashboard = makeDashboard(body)
        const { getByTestId, rerender } = render(
            <TextCardModal dashboard={dashboard} isOpen={false} kind="section" onClose={jest.fn()} textTileId={null} />
        )

        mockValues = {
            ...mockValues,
            textTile: { body, description: 'Key funnel steps', title: 'Activation', transparent_background: true },
        }
        rerender(
            <TextCardModal dashboard={dashboard} isOpen={true} kind="section" onClose={jest.fn()} textTileId={2} />
        )

        expect(getByTestId('dialog')).toHaveAttribute('data-disable-pointer-dismissal', 'false')
    })
})
