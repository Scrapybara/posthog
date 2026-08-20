/**
 * Auto-generated Zod validation schemas from the Django backend OpenAPI schema.
 * To modify these schemas, update the Django serializers or views, then run:
 *   hogli build:openapi
 * Questions or issues? #team-devex on Slack
 *
 * PostHog API - generated
 * OpenAPI spec version: 1.0.0
 */
import * as zod from 'zod'

/**
 * Idempotently delete a single staged or finalized sandbox image attachment for one conversation.
 * @summary Delete one sandbox image attachment
 */
export const AssistantAttachmentsDeleteCreateBody = /* @__PURE__ */ zod.object({
    conversation_id: zod.uuid().describe('Conversation UUID the image attachment belongs to.'),
    attachment_id: zod.uuid().describe('Single attachment ID to delete from staging.'),
})

/**
 * Validate, normalize, and finalize one staged image upload for sandbox messages.
 * @summary Finalize sandbox image uploads
 */
export const AssistantAttachmentsFinalizeCreateBody = /* @__PURE__ */ zod.object({
    conversation_id: zod.uuid().describe('Conversation UUID the uploaded image attachment belongs to.'),
    attachment_id: zod.uuid().describe('Prepared attachment ID to validate and finalize for sandbox use.'),
})

/**
 * Reserve direct-upload image attachment slots for a sandbox conversation and return signed POST fields.
 * @summary Prepare sandbox image uploads
 */
export const assistantAttachmentsPrepareCreateBodyAttachmentsItemFileNameMax = 255

export const assistantAttachmentsPrepareCreateBodyAttachmentsItemSizeMax = 4194304

export const assistantAttachmentsPrepareCreateBodyAttachmentsMax = 4

export const AssistantAttachmentsPrepareCreateBody = /* @__PURE__ */ zod.object({
    conversation_id: zod.uuid().describe('Conversation UUID the staged image attachments belong to.'),
    attachments: zod
        .array(
            zod.object({
                file_name: zod
                    .string()
                    .max(assistantAttachmentsPrepareCreateBodyAttachmentsItemFileNameMax)
                    .describe('File name to associate with the uploaded image.'),
                size: zod
                    .number()
                    .min(1)
                    .max(assistantAttachmentsPrepareCreateBodyAttachmentsItemSizeMax)
                    .describe('Expected upload size in bytes. Each image must be 4194304 bytes or smaller.'),
                content_type: zod
                    .enum(['image/png', 'image/jpeg'])
                    .describe('\* `image\/png` - image\/png\n\* `image\/jpeg` - image\/jpeg')
                    .describe(
                        'Exact MIME type for the direct upload. Only PNG and JPEG are supported.\n\n\* `image\/png` - image\/png\n\* `image\/jpeg` - image\/jpeg'
                    ),
            })
        )
        .min(1)
        .max(assistantAttachmentsPrepareCreateBodyAttachmentsMax)
        .describe('Images to stage for the next sandbox message.'),
})

/**
 * Run a hybrid (semantic + full-text) RAG search over the PostHog documentation via Inkeep. Returns a markdown body with title, URL, and excerpt for each match for the agent to cite back to the user.
 * @summary Search PostHog documentation
 */
export const DocsSearchBody = /* @__PURE__ */ zod.object({
    query: zod
        .string()
        .describe(
            'Natural-language description of what to find in the PostHog documentation. Inkeep performs hybrid (semantic + full-text) RAG, so phrase the query the way a user would ask the question.'
        ),
})
