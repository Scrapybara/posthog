import { expectLogic } from 'kea-test-utils'

import { projectLogic } from 'scenes/projectLogic'

import { useMocks } from '~/mocks/jest'
import { initKeaTests } from '~/test/init'

import {
    assistantAttachmentsDeleteCreate,
    assistantAttachmentsFinalizeCreate,
    assistantAttachmentsPrepareCreate,
} from '../generated/api'
import { MAX_ASSISTANT_ATTACHMENTS } from './assistantAttachmentsLogic'
import { assistantAttachmentsLogic } from './assistantAttachmentsLogic'

jest.mock('../generated/api', () => ({
    assistantAttachmentsPrepareCreate: jest.fn(),
    assistantAttachmentsFinalizeCreate: jest.fn(),
    assistantAttachmentsDeleteCreate: jest.fn(),
}))

function deferred<T>(): { promise: Promise<T>; reject: (error: unknown) => void; resolve: (value: T) => void } {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((innerResolve, innerReject) => {
        resolve = innerResolve
        reject = innerReject
    })
    return { promise, resolve, reject }
}

describe('assistantAttachmentsLogic', () => {
    let logic: ReturnType<typeof assistantAttachmentsLogic.build>
    let projectLogicInstance: ReturnType<typeof projectLogic.build>

    beforeEach(() => {
        initKeaTests()
        useMocks({
            get: {
                '/_preflight/': {},
            },
        })
        Object.defineProperty(URL, 'createObjectURL', {
            configurable: true,
            value: jest.fn((file: File) => `blob:${file.name}`),
        })
        Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() })
        const baseFetch = global.fetch.bind(global)
        global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
            if (typeof input === 'string' && input.startsWith('https://upload.test')) {
                return Promise.resolve({ ok: true } as Response)
            }
            return baseFetch(input, init)
        }) as any

        projectLogicInstance = projectLogic()
        projectLogicInstance.mount()
        projectLogicInstance.actions.loadCurrentProjectSuccess({ id: 1, name: 'Test project' } as any)

        logic = assistantAttachmentsLogic({ conversationId: 'conv-1' })
        logic.mount()
    })

    afterEach(() => {
        logic?.unmount()
        projectLogicInstance?.unmount()
        jest.restoreAllMocks()
    })

    it('validates type, count, size, and uniqueness', async () => {
        ;(assistantAttachmentsPrepareCreate as jest.Mock).mockResolvedValue({ attachments: [] })

        const validFiles = Array.from(
            { length: MAX_ASSISTANT_ATTACHMENTS },
            (_, index) => new File([String(index)], `${index}.png`, { type: 'image/png', lastModified: index })
        )
        const duplicate = new File(['0'], '0.png', { type: 'image/png', lastModified: 0 })
        const unsupported = new File(['svg'], 'a.svg', { type: 'image/svg+xml', lastModified: 10 })
        const empty = new File([], 'empty.png', { type: 'image/png', lastModified: 13 })
        const oversized = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'big.png', {
            type: 'image/png',
            lastModified: 11,
        })
        const extra = new File(['x'], 'extra.png', { type: 'image/png', lastModified: 12 })

        logic.actions.addFiles([...validFiles, duplicate, unsupported, empty, oversized, extra])

        await expectLogic(logic).toMatchValues({ attachments: expect.any(Array) })
        expect(logic.values.attachments).toHaveLength(MAX_ASSISTANT_ATTACHMENTS)
        expect(logic.values.selectionError).toContain('That image is already attached.')
        expect(logic.values.selectionError).toContain('Choose a PNG or JPEG image.')
        expect(logic.values.selectionError).toContain('Choose a non-empty image.')
        expect(logic.values.selectionError).toContain('Each image must be 4 MiB or smaller.')
        expect(logic.values.selectionError).toContain('You can attach up to 4 images.')
    })

    it('rejects files when the selected total would exceed 10 MiB', async () => {
        ;(assistantAttachmentsPrepareCreate as jest.Mock).mockResolvedValue({ attachments: [] })

        logic.actions.addFiles([
            new File([new Uint8Array(4 * 1024 * 1024)], 'a.png', { type: 'image/png', lastModified: 1 }),
            new File([new Uint8Array(4 * 1024 * 1024)], 'b.png', { type: 'image/png', lastModified: 2 }),
            new File([new Uint8Array(3 * 1024 * 1024)], 'c.png', { type: 'image/png', lastModified: 3 }),
        ])

        await expectLogic(logic).toMatchValues({ attachments: expect.any(Array) })
        expect(logic.values.attachments).toHaveLength(2)
        expect(logic.values.selectionError).toContain('Selected images must total 10 MiB or less.')
    })

    it('deletes a prepared attachment once if upload resolves after removal', async () => {
        const uploadDeferred = deferred<Response>()
        ;(assistantAttachmentsPrepareCreate as jest.Mock).mockResolvedValue({
            attachments: [
                {
                    id: 'prepared-1',
                    file_name: 'a.png',
                    content_type: 'image/png',
                    size: 1,
                    upload_url: 'https://upload.test',
                    upload_fields: { key: 'value' },
                },
            ],
        })
        ;(global.fetch as jest.Mock).mockReturnValue(uploadDeferred.promise)
        ;(assistantAttachmentsFinalizeCreate as jest.Mock).mockResolvedValue({
            id: 'prepared-1',
            file_name: 'a.png',
            content_type: 'image/png',
            size: 1,
            width: 1,
            height: 1,
        })
        ;(assistantAttachmentsDeleteCreate as jest.Mock).mockResolvedValue(undefined)

        logic.actions.addFiles([new File(['a'], 'a.png', { type: 'image/png' })])
        await expectLogic(logic).toDispatchActions(['uploadAttachment'])

        const localId = logic.values.attachments[0]?.localId
        expect(localId).toBeTruthy()
        logic.actions.removeAttachment(localId as string)
        uploadDeferred.resolve({ ok: true } as Response)

        await expectLogic(logic).toFinishAllListeners()
        expect(assistantAttachmentsDeleteCreate).toHaveBeenCalledTimes(1)
        expect(assistantAttachmentsDeleteCreate).toHaveBeenCalledWith('1', {
            conversation_id: 'conv-1',
            attachment_id: 'prepared-1',
        })
    })

    it('deletes a prepared attachment once if finalize resolves after unmount', async () => {
        const finalizeDeferred = deferred<any>()
        ;(assistantAttachmentsPrepareCreate as jest.Mock).mockResolvedValue({
            attachments: [
                {
                    id: 'prepared-2',
                    file_name: 'b.png',
                    content_type: 'image/png',
                    size: 1,
                    upload_url: 'https://upload.test',
                    upload_fields: { key: 'value' },
                },
            ],
        })
        ;(global.fetch as jest.Mock).mockResolvedValue({ ok: true } as Response)
        ;(assistantAttachmentsFinalizeCreate as jest.Mock).mockReturnValue(finalizeDeferred.promise)
        ;(assistantAttachmentsDeleteCreate as jest.Mock).mockResolvedValue(undefined)

        logic.actions.addFiles([new File(['b'], 'b.png', { type: 'image/png' })])
        await expectLogic(logic).toDispatchActions(['uploadAttachment'])

        logic.unmount()
        finalizeDeferred.resolve({
            id: 'prepared-2',
            file_name: 'b.png',
            content_type: 'image/png',
            size: 1,
            width: 1,
            height: 1,
        })

        await Promise.resolve()
        await Promise.resolve()

        expect(assistantAttachmentsDeleteCreate).toHaveBeenCalledTimes(1)
        expect(assistantAttachmentsDeleteCreate).toHaveBeenCalledWith('1', {
            conversation_id: 'conv-1',
            attachment_id: 'prepared-2',
        })
    })

    it('keeps attachments while a send is pending and clears them only after success', () => {
        logic.actions.addAttachment({
            localId: 'local-send',
            file: new File(['a'], 'a.png', { type: 'image/png' }),
            fileKey: 'a.png:image/png:1:0',
            previewUrl: 'blob:a.png',
            status: 'ready',
            attachmentId: 'prepared-send',
        })

        logic.actions.beginAttachmentsSend(['prepared-send'])
        expect(logic.values.attachmentsAreSending).toBe(true)
        expect(logic.values.attachmentSubmissionDisabledReason).toBe('Wait for images to finish sending')
        expect(logic.values.attachments).toHaveLength(1)

        logic.actions.markAttachmentsSendFailed(['prepared-send'])
        expect(logic.values.attachmentsAreSending).toBe(false)
        expect(logic.values.attachments).toHaveLength(1)

        logic.actions.beginAttachmentsSend(['prepared-send'])
        logic.actions.markAttachmentsSent(['prepared-send'])
        expect(logic.values.attachmentsAreSending).toBe(false)
        expect(logic.values.attachments).toHaveLength(0)
    })

    it('deletes an attachment through the project that prepared it', async () => {
        ;(assistantAttachmentsPrepareCreate as jest.Mock).mockResolvedValue({
            attachments: [
                {
                    id: 'prepared-project',
                    file_name: 'project.png',
                    content_type: 'image/png',
                    size: 1,
                    upload_url: 'https://upload.test',
                    upload_fields: { key: 'value' },
                },
            ],
        })
        ;(assistantAttachmentsFinalizeCreate as jest.Mock).mockResolvedValue({
            id: 'prepared-project',
            file_name: 'project.png',
            content_type: 'image/png',
            size: 1,
            width: 1,
            height: 1,
        })
        ;(assistantAttachmentsDeleteCreate as jest.Mock).mockResolvedValue(undefined)

        logic.actions.addFiles([new File(['a'], 'project.png', { type: 'image/png' })])
        await expectLogic(logic).toFinishAllListeners()
        projectLogicInstance.actions.loadCurrentProjectSuccess({ id: 2, name: 'Other project' } as any)

        logic.actions.removeAttachment(logic.values.attachments[0].localId)
        await expectLogic(logic).toFinishAllListeners()

        expect(assistantAttachmentsDeleteCreate).toHaveBeenCalledWith('1', {
            conversation_id: 'conv-1',
            attachment_id: 'prepared-project',
        })
    })
})
