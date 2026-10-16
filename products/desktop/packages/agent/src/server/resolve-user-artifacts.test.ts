import { describe, expect, it, vi } from "vitest";

import type { TaskRunArtifact } from "../types";
import {
  resolveLegacyArtifactsFromManifest,
  validateUserArtifactData,
} from "./resolve-user-artifacts";

describe("validateUserArtifactData", () => {
  const artifact: TaskRunArtifact = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "screen.png",
    type: "context",
    source: "user_attachment",
    size: 3,
    content_type: "image/png",
    storage_path: "artifacts/screen.png",
    uploaded_by: "user",
    uploaded_by_user_id: 1,
  };

  it.each([
    ["empty", new ArrayBuffer(0)],
    ["different from the manifest size", new Uint8Array([1, 2]).buffer],
    ["larger than 4 MiB", new ArrayBuffer(4 * 1024 * 1024 + 1)],
  ])("rejects %s screenshot content", (_name, data) => {
    expect(() => validateUserArtifactData(artifact, data)).toThrow(
      "Screenshot attachment content is invalid",
    );
  });

  it("accepts screenshot content matching the validated manifest", () => {
    expect(() =>
      validateUserArtifactData(artifact, new Uint8Array([1, 2, 3]).buffer),
    ).not.toThrow();
  });
});

describe("resolveLegacyArtifactsFromManifest", () => {
  const manifestArtifact: TaskRunArtifact = {
    id: "artifact-1",
    name: "report.txt",
    type: "context",
    source: "agent_output",
    size: 6,
    content_type: "text/plain",
    storage_path: "tasks/artifacts/report.txt",
    uploaded_by: "agent",
  };

  it("returns canonical manifest metadata instead of caller metadata", async () => {
    const getTaskRun = vi.fn(async () => ({
      artifacts: [manifestArtifact],
    }));

    const resolved = await resolveLegacyArtifactsFromManifest(
      { getTaskRun } as never,
      "task-1",
      "run-1",
      [
        {
          ...manifestArtifact,
          name: "../../escaped.txt",
          source: "user_attachment",
          content_type: "image/png",
        },
      ],
    );

    expect(resolved).toEqual([manifestArtifact]);
  });

  it.each([
    ["unknown id", { id: "../../target" }],
    [
      "mismatched storage path",
      { id: manifestArtifact.id, storage_path: "tasks/artifacts/other.txt" },
    ],
    ["missing selector", { name: "report.txt" }],
  ])("rejects a legacy artifact with %s", async (_name, suppliedArtifact) => {
    const getTaskRun = vi.fn(async () => ({
      artifacts: [manifestArtifact],
    }));

    await expect(
      resolveLegacyArtifactsFromManifest(
        { getTaskRun } as never,
        "task-1",
        "run-1",
        [suppliedArtifact],
      ),
    ).rejects.toThrow("Artifacts are unavailable for this task run");
  });
});
