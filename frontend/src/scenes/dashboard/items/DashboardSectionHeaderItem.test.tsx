import '@testing-library/jest-dom'

import { fireEvent, render } from '@testing-library/react'

import { initKeaTests } from '~/test/init'
import { DashboardPlacement, DashboardTile, QueryBasedInsightModel } from '~/types'

import { DashboardSectionHeaderItem } from './DashboardSectionHeaderItem'

const tile = {
    id: 1,
    text: { body: 'stored body', last_modified_at: '2024-01-01T00:00:00Z' },
    layouts: {},
    color: null,
} as DashboardTile<QueryBasedInsightModel>

describe('DashboardSectionHeaderItem', () => {
    beforeEach(() => {
        initKeaTests()
    })

    it('renders user text literally without editing controls on public dashboards', () => {
        const { container, getByText, queryByLabelText } = render(
            <DashboardSectionHeaderItem
                tile={tile}
                sectionHeader={{ title: '<img src=x>', description: '**Literal description**' }}
                placement={DashboardPlacement.Public}
                onEdit={jest.fn()}
                onDuplicate={jest.fn()}
            />
        )

        expect(getByText('<img src=x>')).toBeInTheDocument()
        expect(getByText('**Literal description**')).toBeInTheDocument()
        expect(container.querySelector('img')).toBeNull()
        expect(queryByLabelText('more')).not.toBeInTheDocument()
    })

    it('offers existing tile actions on editable dashboards', () => {
        const { getByLabelText, getByText } = render(
            <DashboardSectionHeaderItem
                tile={tile}
                sectionHeader={{ title: 'Acquisition', description: '' }}
                placement={DashboardPlacement.Dashboard}
                dashboardId={123}
                onEdit={jest.fn()}
                onDuplicate={jest.fn()}
                onRemove={jest.fn()}
            />
        )

        fireEvent.click(getByLabelText('more'))
        expect(getByText('Edit section header')).toBeInTheDocument()
        expect(getByText('Duplicate')).toBeInTheDocument()
        expect(getByText('Delete')).toBeInTheDocument()
    })
})
