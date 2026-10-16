import uuid
from typing import Any

from posthog.test.base import APIBaseTest
from unittest.mock import patch

from parameterized import parameterized

from posthog.models.user import User

from products.tasks.backend.facade import api as tasks_facade
from products.tasks.backend.models import Task, TaskRun


class TestPosthogAIAttachmentPromotionFacade(APIBaseTest):
    def _task_and_run(self) -> tuple[Task, TaskRun]:
        task = Task.objects.create(
            team=self.team,
            title="t",
            description="d",
            origin_product=Task.OriginProduct.POSTHOG_AI,
            created_by=self.user,
        )
        run = task.create_run(mode="interactive")
        return task, run

    def _attachment(self, *, attachment_id: str, conversation_id: str) -> dict[str, Any]:
        return {
            "id": attachment_id,
            "team_id": self.team.id,
            "user_id": self.user.id,
            "conversation_id": conversation_id,
            "file_name": "image.png",
            "normalized_storage_path": (
                f"posthog_ai/assistant_attachments/team_{self.team.id}/user_{self.user.id}/"
                f"conversation_{conversation_id}/normalized/{attachment_id}.png"
            ),
            "normalized_size": 123,
            "content_type": "image/png",
            "width": 10,
            "height": 12,
            "status": "finalized",
        }

    def test_tag_failure_leaves_no_manifest_entry(self) -> None:
        task, run = self._task_and_run()
        attachment_id = str(uuid.uuid4())
        conversation_id = str(uuid.uuid4())

        with (
            patch("posthog.storage.object_storage.copy"),
            patch("posthog.storage.object_storage.tag", side_effect=RuntimeError("tag failed")),
            patch("posthog.storage.object_storage.delete") as m_delete,
        ):
            with self.assertRaises(RuntimeError):
                tasks_facade.promote_posthog_ai_attachments(
                    task_id=task.id,
                    run_id=run.id,
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=conversation_id,
                    attachments=[self._attachment(attachment_id=attachment_id, conversation_id=conversation_id)],
                )

        run.refresh_from_db()
        self.assertEqual(run.artifacts, [])
        self.assertEqual(m_delete.call_count, 1)

    def test_existing_artifact_id_is_not_duplicated(self) -> None:
        task, run = self._task_and_run()
        attachment_id = str(uuid.uuid4())
        conversation_id = str(uuid.uuid4())
        run.artifacts = [
            {
                "id": attachment_id,
                "name": "image.png",
                "type": "context",
                "source": "user_attachment",
                "size": 123,
                "content_type": "image/png",
                "storage_path": "existing/path.png",
                "uploaded_at": "2026-01-01T00:00:00+00:00",
                "metadata": {"conversation_id": conversation_id, "width": 10, "height": 12},
            }
        ]
        run.save(update_fields=["artifacts", "updated_at"])

        with (
            patch("posthog.storage.object_storage.copy") as copy,
            patch("posthog.storage.object_storage.tag") as tag,
        ):
            result = tasks_facade.promote_posthog_ai_attachments(
                task_id=task.id,
                run_id=run.id,
                team_id=self.team.id,
                user_id=self.user.id,
                conversation_id=conversation_id,
                attachments=[self._attachment(attachment_id=attachment_id, conversation_id=conversation_id)],
            )

        run.refresh_from_db()
        assert result is not None
        self.assertEqual(result.attached_ids, [attachment_id])
        self.assertEqual(result.newly_attached_ids, [])
        self.assertEqual([entry["id"] for entry in run.artifacts], [attachment_id])
        copy.assert_not_called()
        tag.assert_not_called()

    def test_team_member_can_promote_attachment_to_task_created_by_another_user(self) -> None:
        creator = User.objects.create_user(email="creator@example.com", first_name="Creator", password="password")
        task = Task.objects.create(
            team=self.team,
            title="t",
            description="d",
            origin_product=Task.OriginProduct.POSTHOG_AI,
            created_by=creator,
        )
        run = task.create_run(mode="interactive")
        attachment_id = str(uuid.uuid4())
        conversation_id = str(uuid.uuid4())

        with (
            patch("posthog.storage.object_storage.copy"),
            patch("posthog.storage.object_storage.tag"),
        ):
            result = tasks_facade.promote_posthog_ai_attachments(
                task_id=task.id,
                run_id=run.id,
                team_id=self.team.id,
                user_id=self.user.id,
                conversation_id=conversation_id,
                attachments=[self._attachment(attachment_id=attachment_id, conversation_id=conversation_id)],
            )

        assert result is not None
        self.assertEqual(result.attached_ids, [attachment_id])

    def test_pending_attachment_is_hidden_until_delivery_is_committed(self) -> None:
        task, run = self._task_and_run()
        attachment_id = str(uuid.uuid4())
        conversation_id = str(uuid.uuid4())

        with (
            patch("posthog.storage.object_storage.copy"),
            patch("posthog.storage.object_storage.tag"),
        ):
            result = tasks_facade.promote_posthog_ai_attachments(
                task_id=task.id,
                run_id=run.id,
                team_id=self.team.id,
                user_id=self.user.id,
                conversation_id=conversation_id,
                attachments=[self._attachment(attachment_id=attachment_id, conversation_id=conversation_id)],
            )

        response = self.client.get(f"/api/projects/@current/tasks/{task.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["latest_run"]["artifacts"], [])
        agent_run = tasks_facade.get_task_run_detail(
            run.id,
            task.id,
            self.team.id,
            include_pending_artifacts=True,
        )
        assert agent_run is not None
        self.assertEqual([artifact["id"] for artifact in agent_run.artifacts], [attachment_id])
        self.assertNotIn("_posthog_ai_pending_delivery", agent_run.artifacts[0])
        run.refresh_from_db()
        storage_path = run.artifacts[0]["storage_path"]
        with patch("posthog.storage.object_storage.get_presigned_url", return_value="https://example.com/image"):
            self.assertEqual(
                tasks_facade.presign_task_run_artifact(
                    run.id,
                    task.id,
                    self.team.id,
                    storage_path=storage_path,
                ),
                (None, "not_found"),
            )
            self.assertEqual(
                tasks_facade.presign_task_run_artifact(
                    run.id,
                    task.id,
                    self.team.id,
                    storage_path=storage_path,
                    include_pending_artifacts=True,
                ),
                ("https://example.com/image", None),
            )

        assert result is not None
        tasks_facade.commit_posthog_ai_attachments(
            task_id=task.id,
            run_id=run.id,
            team_id=self.team.id,
            attachment_ids=result.newly_attached_ids,
        )
        response = self.client.get(f"/api/projects/@current/tasks/{task.id}/")

        self.assertEqual(response.status_code, 200)
        artifact = response.json()["latest_run"]["artifacts"][0]
        self.assertEqual(artifact["id"], attachment_id)
        self.assertEqual(
            artifact["metadata"],
            {"conversation_id": conversation_id, "width": 10, "height": 12},
        )

    def test_failed_rollback_leaves_pending_attachment_hidden(self) -> None:
        task, run = self._task_and_run()
        attachment_id = str(uuid.uuid4())
        conversation_id = str(uuid.uuid4())

        with (
            patch("posthog.storage.object_storage.copy"),
            patch("posthog.storage.object_storage.tag"),
        ):
            tasks_facade.promote_posthog_ai_attachments(
                task_id=task.id,
                run_id=run.id,
                team_id=self.team.id,
                user_id=self.user.id,
                conversation_id=conversation_id,
                attachments=[self._attachment(attachment_id=attachment_id, conversation_id=conversation_id)],
            )

        with patch(
            "products.tasks.backend.facade.api._save_artifact_manifest", side_effect=RuntimeError("save failed")
        ):
            with self.assertRaisesRegex(RuntimeError, "save failed"):
                tasks_facade.rollback_posthog_ai_attachments(
                    task_id=task.id,
                    run_id=run.id,
                    team_id=self.team.id,
                    attachment_ids=[attachment_id],
                )

        run.refresh_from_db()
        self.assertTrue(run.artifacts[0]["_posthog_ai_pending_delivery"])
        public_run = tasks_facade.get_task_run_detail(run.id, task.id, self.team.id)
        assert public_run is not None
        self.assertEqual(public_run.artifacts, [])

    def test_manifest_failure_deletes_every_copied_object(self) -> None:
        task, run = self._task_and_run()
        attachment_id = str(uuid.uuid4())
        conversation_id = str(uuid.uuid4())

        with (
            patch("posthog.storage.object_storage.copy"),
            patch("posthog.storage.object_storage.tag"),
            patch("posthog.storage.object_storage.delete") as delete,
            patch("products.tasks.backend.facade.api._save_artifact_manifest", side_effect=RuntimeError("save failed")),
        ):
            with self.assertRaisesRegex(RuntimeError, "save failed"):
                tasks_facade.promote_posthog_ai_attachments(
                    task_id=task.id,
                    run_id=run.id,
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=conversation_id,
                    attachments=[self._attachment(attachment_id=attachment_id, conversation_id=conversation_id)],
                )

        delete.assert_called_once()

    @parameterized.expand(
        [
            ("wrong_team", "team_id", -1),
            ("unsupported_type", "content_type", "text/plain"),
            ("oversized", "normalized_size", 4 * 1024 * 1024 + 1),
            ("too_many_pixels", "width", 20_000_000),
            ("untrusted_path", "normalized_storage_path", "https://example.com/image.png"),
        ]
    )
    def test_rejects_unsafe_manifest_fields(self, _name: str, field: str, value: Any) -> None:
        task, run = self._task_and_run()
        attachment_id = str(uuid.uuid4())
        conversation_id = str(uuid.uuid4())
        attachment = self._attachment(attachment_id=attachment_id, conversation_id=conversation_id)
        attachment[field] = value

        with patch("posthog.storage.object_storage.copy") as copy:
            with self.assertRaises(ValueError):
                tasks_facade.promote_posthog_ai_attachments(
                    task_id=task.id,
                    run_id=run.id,
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=conversation_id,
                    attachments=[attachment],
                )

        copy.assert_not_called()
