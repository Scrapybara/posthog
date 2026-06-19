import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import { HogFunctionInvocationStatus, HogFunctionInvocationStatusTag } from './HogFunctionInvocationStatusTag'

describe('HogFunctionInvocationStatusTag', () => {
    it.each([
        ['success', 'Success'],
        ['failure', 'Failure'],
        ['running', 'Running'],
        ['not tested', 'Not tested'],
        ['unknown', 'Unknown'],
    ] satisfies [HogFunctionInvocationStatus, string][])(
        'renders %s with a visible icon and accessible label',
        (status, label) => {
            render(<HogFunctionInvocationStatusTag status={status} />)

            const tag = screen.getByLabelText(`Status: ${label}`)

            expect(tag).toHaveTextContent(label)
            expect(tag.querySelector('svg')).toBeInTheDocument()
        }
    )
})
