import { apiMutator } from '../../../../frontend/src/lib/api-orval-mutator'
/**
 * Auto-generated from the Django backend OpenAPI schema.
 * To modify these types, update the Django serializers or views, then run:
 *   hogli build:openapi
 * Questions or issues? #team-devex on Slack
 *
 * PostHog API - generated
 * OpenAPI spec version: 1.0.0
 */
import type {
    AttachmentDeleteRequestApi,
    AttachmentFinalizeRequestApi,
    AttachmentFinalizeResponseApi,
    AttachmentPrepareRequestApi,
    AttachmentPrepareResponseApi,
    DocsSearchRequestApi,
    DocsSearchResponseApi,
    McpToolsCreate200,
} from './api.schemas'

export const getAssistantAttachmentsDeleteCreateUrl = (projectId: string) => {
    return `/api/projects/${projectId}/assistant_attachments/delete/`
}

/**
 * Idempotently delete a single staged or finalized sandbox image attachment for one conversation.
 * @summary Delete one sandbox image attachment
 */
export const assistantAttachmentsDeleteCreate = async (
    projectId: string,
    attachmentDeleteRequestApi: AttachmentDeleteRequestApi,
    options?: RequestInit
): Promise<void> => {
    return apiMutator<void>(getAssistantAttachmentsDeleteCreateUrl(projectId), {
        ...options,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...options?.headers },
        body: JSON.stringify(attachmentDeleteRequestApi),
    })
}

export const getAssistantAttachmentsFinalizeCreateUrl = (projectId: string) => {
    return `/api/projects/${projectId}/assistant_attachments/finalize/`
}

/**
 * Validate, normalize, and finalize one staged image upload for sandbox messages.
 * @summary Finalize sandbox image uploads
 */
export const assistantAttachmentsFinalizeCreate = async (
    projectId: string,
    attachmentFinalizeRequestApi: AttachmentFinalizeRequestApi,
    options?: RequestInit
): Promise<AttachmentFinalizeResponseApi> => {
    return apiMutator<AttachmentFinalizeResponseApi>(getAssistantAttachmentsFinalizeCreateUrl(projectId), {
        ...options,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...options?.headers },
        body: JSON.stringify(attachmentFinalizeRequestApi),
    })
}

export const getAssistantAttachmentsPrepareCreateUrl = (projectId: string) => {
    return `/api/projects/${projectId}/assistant_attachments/prepare/`
}

/**
 * Reserve direct-upload image attachment slots for a sandbox conversation and return signed POST fields.
 * @summary Prepare sandbox image uploads
 */
export const assistantAttachmentsPrepareCreate = async (
    projectId: string,
    attachmentPrepareRequestApi: AttachmentPrepareRequestApi,
    options?: RequestInit
): Promise<AttachmentPrepareResponseApi> => {
    return apiMutator<AttachmentPrepareResponseApi>(getAssistantAttachmentsPrepareCreateUrl(projectId), {
        ...options,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...options?.headers },
        body: JSON.stringify(attachmentPrepareRequestApi),
    })
}

export const getMcpToolsCreateUrl = (projectId: string, toolName: string) => {
    return `/api/projects/${projectId}/mcp_tools/${toolName}/`
}

/**
 * Invoke an MCP tool by name.
 *
 * This endpoint allows MCP callers to invoke Max AI tools directly
 * without going through the full LangChain conversation flow.
 *
 * Scopes are resolved dynamically per tool via dangerously_get_required_scopes.
 */
export const mcpToolsCreate = async (
    projectId: string,
    toolName: string,
    options?: RequestInit
): Promise<McpToolsCreate200> => {
    return apiMutator<McpToolsCreate200>(getMcpToolsCreateUrl(projectId, toolName), {
        ...options,
        method: 'POST',
    })
}

export const getDocsSearchUrl = (projectId: string) => {
    return `/api/projects/${projectId}/mcp_tools/docs_search/`
}

/**
 * Run a hybrid (semantic + full-text) RAG search over the PostHog documentation via Inkeep. Returns a markdown body with title, URL, and excerpt for each match for the agent to cite back to the user.
 * @summary Search PostHog documentation
 */
export const docsSearch = async (
    projectId: string,
    docsSearchRequestApi: DocsSearchRequestApi,
    options?: RequestInit
): Promise<DocsSearchResponseApi> => {
    return apiMutator<DocsSearchResponseApi>(getDocsSearchUrl(projectId), {
        ...options,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...options?.headers },
        body: JSON.stringify(docsSearchRequestApi),
    })
}
