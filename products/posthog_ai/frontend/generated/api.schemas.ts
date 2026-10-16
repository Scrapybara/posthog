/**
 * Auto-generated from the Django backend OpenAPI schema.
 * To modify these types, update the Django serializers or views, then run:
 *   hogli build:openapi
 * Questions or issues? #team-devex on Slack
 *
 * PostHog API - generated
 * OpenAPI spec version: 1.0.0
 */
export interface AttachmentDeleteRequestApi {
    /** Conversation UUID the image attachment belongs to. */
    conversation_id: string
    /** Single attachment ID to delete from staging. */
    attachment_id: string
}

export interface AttachmentFinalizeRequestApi {
    /** Conversation UUID the uploaded image attachment belongs to. */
    conversation_id: string
    /** Prepared attachment ID to validate and finalize for sandbox use. */
    attachment_id: string
}

/**
 * * `image/png` - image/png
 * * `image/jpeg` - image/jpeg
 */
export type AssistantAttachmentContentTypeEnumApi =
    (typeof AssistantAttachmentContentTypeEnumApi)[keyof typeof AssistantAttachmentContentTypeEnumApi]

export const AssistantAttachmentContentTypeEnumApi = {
    ImagePng: 'image/png',
    ImageJpeg: 'image/jpeg',
} as const

export interface AttachmentFinalizeResponseApi {
    /** Opaque attachment ID for sandbox message sends. */
    id: string
    /** Sanitized file name recorded for the image attachment. */
    file_name: string
    /** Validated MIME type for the normalized image.
     *
     * * `image/png` - image/png
     * * `image/jpeg` - image/jpeg */
    content_type: AssistantAttachmentContentTypeEnumApi
    /** Normalized image size in bytes. */
    size: number
    /** Normalized image width in pixels. */
    width: number
    /** Normalized image height in pixels. */
    height: number
}

export interface AttachmentPrepareItemApi {
    /**
     * File name to associate with the uploaded image.
     * @maxLength 255
     */
    file_name: string
    /**
     * Expected upload size in bytes. Each image must be 4194304 bytes or smaller.
     * @minimum 1
     * @maximum 4194304
     */
    size: number
    /** Exact MIME type for the direct upload. Only PNG and JPEG are supported.
     *
     * * `image/png` - image/png
     * * `image/jpeg` - image/jpeg */
    content_type: AssistantAttachmentContentTypeEnumApi
}

export interface AttachmentPrepareRequestApi {
    /** Conversation UUID the staged image attachments belong to. */
    conversation_id: string
    /**
     * Images to stage for the next sandbox message.
     * @minItems 1
     * @maxItems 4
     */
    attachments: AttachmentPrepareItemApi[]
}

/**
 * Signed S3-compatible form fields to include with the upload request.
 */
export type AttachmentPrepareResponseItemApiUploadFields = { [key: string]: string }

export interface AttachmentPrepareResponseItemApi {
    /** Opaque attachment ID for finalize, delete, and sandbox message sends. */
    id: string
    /** Sanitized file name recorded for the image attachment. */
    file_name: string
    /** Signed MIME type for the upload.
     *
     * * `image/png` - image/png
     * * `image/jpeg` - image/jpeg */
    content_type: AssistantAttachmentContentTypeEnumApi
    /** Expected upload size in bytes. */
    size: number
    /** Signed direct-upload URL for the image attachment. */
    upload_url: string
    /** Signed S3-compatible form fields to include with the upload request. */
    upload_fields: AttachmentPrepareResponseItemApiUploadFields
}

export interface AttachmentPrepareResponseApi {
    /** Prepared image uploads. */
    attachments: AttachmentPrepareResponseItemApi[]
}

export interface DocsSearchRequestApi {
    /** Natural-language description of what to find in the PostHog documentation. Inkeep performs hybrid (semantic + full-text) RAG, so phrase the query the way a user would ask the question. */
    query: string
}

export interface DocsSearchResponseApi {
    /** Markdown-formatted documentation results. Each block has a title, URL and excerpt; an empty result set returns guidance to navigate to https://posthog.com/docs. */
    content: string
}

export type McpToolsCreate200 = { [key: string]: unknown }
