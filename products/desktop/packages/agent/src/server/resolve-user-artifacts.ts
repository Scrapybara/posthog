import type { PostHogAPIClient } from "../posthog-api";
import type { TaskRunArtifact } from "../types";

export const MAX_USER_ATTACHMENT_BYTES = 4 * 1024 * 1024;

export function validateUserArtifactData(
  artifact: TaskRunArtifact,
  data: ArrayBuffer,
): void {
  if (artifact.source !== "user_attachment") {
    return;
  }
  if (
    data.byteLength === 0 ||
    data.byteLength > MAX_USER_ATTACHMENT_BYTES ||
    data.byteLength !== artifact.size
  ) {
    throw new Error("Screenshot attachment content is invalid");
  }
}

function isScreenshotAttachment(
  artifact: TaskRunArtifact,
): artifact is TaskRunArtifact & {
  id: string;
  content_type: "image/png" | "image/jpeg";
  size: number;
  storage_path: string;
} {
  return (
    artifact.type === "context" &&
    artifact.source === "user_attachment" &&
    artifact.uploaded_by === "user" &&
    typeof artifact.uploaded_by_user_id === "number" &&
    Number.isInteger(artifact.uploaded_by_user_id) &&
    artifact.uploaded_by_user_id > 0 &&
    (artifact.content_type === "image/png" ||
      artifact.content_type === "image/jpeg") &&
    typeof artifact.size === "number" &&
    Number.isInteger(artifact.size) &&
    artifact.size > 0 &&
    artifact.size <= MAX_USER_ATTACHMENT_BYTES &&
    typeof artifact.storage_path === "string" &&
    artifact.storage_path.length > 0
  );
}

export async function resolveUserArtifactsById(
  posthogAPI: Pick<PostHogAPIClient, "getTaskRun">,
  taskId: string,
  runId: string,
  artifactIds: string[],
): Promise<TaskRunArtifact[]> {
  if (artifactIds.length === 0) {
    return [];
  }

  const taskRun = await posthogAPI.getTaskRun(taskId, runId);
  const artifactsById = new Map<string, TaskRunArtifact>(
    (taskRun.artifacts ?? []).flatMap((artifact) =>
      artifact.id && isScreenshotAttachment(artifact)
        ? [[artifact.id, artifact] as const]
        : [],
    ),
  );
  const resolvedArtifacts: TaskRunArtifact[] = [];
  const missingArtifactIds = new Set<string>();
  for (const artifactId of artifactIds) {
    const artifact = artifactsById.get(artifactId);
    if (artifact) {
      resolvedArtifacts.push(artifact);
    } else {
      missingArtifactIds.add(artifactId);
    }
  }
  if (missingArtifactIds.size > 0) {
    throw new Error("Screenshot attachments are unavailable for this task run");
  }

  return resolvedArtifacts;
}

export async function resolveLegacyArtifactsFromManifest(
  posthogAPI: Pick<PostHogAPIClient, "getTaskRun">,
  taskId: string,
  runId: string,
  suppliedArtifacts: unknown[],
): Promise<TaskRunArtifact[]> {
  if (suppliedArtifacts.length === 0) {
    return [];
  }

  const taskRun = await posthogAPI.getTaskRun(taskId, runId);
  const manifest = taskRun.artifacts ?? [];
  const resolvedArtifacts: TaskRunArtifact[] = [];
  const resolvedKeys = new Set<string>();

  for (const suppliedArtifact of suppliedArtifacts) {
    if (!suppliedArtifact || typeof suppliedArtifact !== "object") {
      throw new Error("Artifacts are unavailable for this task run");
    }
    const supplied = suppliedArtifact as Record<string, unknown>;
    const suppliedId =
      typeof supplied.id === "string" && supplied.id.length > 0
        ? supplied.id
        : null;
    const suppliedStoragePath =
      typeof supplied.storage_path === "string" &&
      supplied.storage_path.length > 0
        ? supplied.storage_path
        : null;
    const artifact = manifest.find((candidate) =>
      suppliedId
        ? candidate.id === suppliedId &&
          (!suppliedStoragePath ||
            candidate.storage_path === suppliedStoragePath)
        : suppliedStoragePath
          ? candidate.storage_path === suppliedStoragePath
          : false,
    );
    if (!artifact) {
      throw new Error("Artifacts are unavailable for this task run");
    }

    const key = artifact.id ?? artifact.storage_path;
    if (key && !resolvedKeys.has(key)) {
      resolvedKeys.add(key);
      resolvedArtifacts.push(artifact);
    }
  }

  return resolvedArtifacts;
}
