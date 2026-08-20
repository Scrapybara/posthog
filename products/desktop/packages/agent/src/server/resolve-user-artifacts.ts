import type { PostHogAPIClient } from "../posthog-api";
import type { TaskRunArtifact } from "../types";

const MAX_USER_ATTACHMENT_BYTES = 4 * 1024 * 1024;

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
