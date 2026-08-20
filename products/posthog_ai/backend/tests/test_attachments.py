import time
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from types import SimpleNamespace
from typing import Any

from posthog.test.base import APIBaseTest
from unittest.mock import patch

from parameterized import parameterized
from PIL import Image, PngImagePlugin

from products.posthog_ai.backend.attachments import (
    ATTACHMENT_UPLOAD_EXPIRATION_SECONDS,
    AttachmentPromotion,
    AttachmentStorageError,
    AttachmentValidationError,
    _conversation_index_key,
    _get_index,
    _get_record,
    _normalized_storage_path,
    _raw_storage_path,
    _user_index_key,
    _validate_and_normalize_image,
    _write_records_and_indexes,
    delete_attachment,
    finalize_attachments,
    prepare_attachments,
    promote_attachments,
    rollback_attachment_promotion,
)


class TestAssistantAttachments(APIBaseTest):
    def setUp(self) -> None:
        super().setUp()
        self.conversation_id = uuid.uuid4()

    def _png_bytes(self) -> bytes:
        image = Image.new("RGB", (4, 4), color="red")
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()

    def _jpeg_bytes(self) -> bytes:
        image = Image.new("RGB", (4, 4), color="red")
        buffer = BytesIO()
        image.save(buffer, format="JPEG")
        return buffer.getvalue()

    def _seed_prepared_record(self, attachment_id: str, *, size: int) -> None:
        record = {
            "id": attachment_id,
            "team_id": self.team.id,
            "user_id": self.user.id,
            "conversation_id": str(self.conversation_id),
            "file_name": "image.png",
            "content_type": "image/png",
            "declared_size": size,
            "raw_storage_path": _raw_storage_path(self.team.id, self.user.id, self.conversation_id, attachment_id),
            "status": "prepared",
            "created_at": "2026-01-01T00:00:00+00:00",
            "upload_expires_at": time.time() + ATTACHMENT_UPLOAD_EXPIRATION_SECONDS,
        }
        _write_records_and_indexes(
            records=[record],
            team_id=self.team.id,
            user_id=self.user.id,
            conversation_id=self.conversation_id,
            conversation_ids=[attachment_id],
            user_ids=[attachment_id],
        )

    def test_prepare_attachments_uses_fifteen_minute_expiry(self) -> None:
        with patch("products.posthog_ai.backend.attachments.object_storage.get_presigned_post") as m_post:
            m_post.return_value = {"url": "https://example.com/upload", "fields": {"policy": "abc"}}
            prepared = prepare_attachments(
                team_id=self.team.id,
                user_id=self.user.id,
                conversation_id=self.conversation_id,
                attachments=[{"file_name": "image.png", "content_type": "image/png", "size": 10}],
            )

        self.assertEqual(m_post.call_args.kwargs["expiration"], ATTACHMENT_UPLOAD_EXPIRATION_SECONDS)
        self.assertIn(["content-length-range", 10, 10], m_post.call_args.kwargs["conditions"])
        self.assertEqual(ATTACHMENT_UPLOAD_EXPIRATION_SECONDS, 15 * 60)
        self.assertEqual(prepared[0].upload_fields["policy"], "abc")
        self.assertEqual(prepared[0].upload_fields["Content-Type"], "image/png")
        self.assertEqual(
            prepared[0].upload_fields["x-amz-tagging"],
            f"ttl_days=1&team_id={self.team.id}",
        )

    def test_prepare_enforces_per_user_staging_count_across_conversations(self) -> None:
        upload = {"file_name": "image.png", "content_type": "image/png", "size": 1}
        presigned_post = {"url": "https://example.com/upload", "fields": {"policy": "abc"}}

        with patch(
            "products.posthog_ai.backend.attachments.object_storage.get_presigned_post",
            return_value=presigned_post,
        ):
            for _ in range(5):
                prepare_attachments(
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=uuid.uuid4(),
                    attachments=[upload] * 4,
                )

            with self.assertRaisesRegex(AttachmentValidationError, "up to 20 images"):
                prepare_attachments(
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=uuid.uuid4(),
                    attachments=[upload],
                )

    def test_prepare_enforces_per_user_staging_bytes_across_conversations(self) -> None:
        four_mib_upload = {
            "file_name": "image.png",
            "content_type": "image/png",
            "size": 4 * 1024 * 1024,
        }
        three_mib_upload = {
            "file_name": "image.png",
            "content_type": "image/png",
            "size": 3 * 1024 * 1024,
        }
        presigned_post = {"url": "https://example.com/upload", "fields": {"policy": "abc"}}

        with patch(
            "products.posthog_ai.backend.attachments.object_storage.get_presigned_post",
            return_value=presigned_post,
        ):
            for _ in range(6):
                prepare_attachments(
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=uuid.uuid4(),
                    attachments=[four_mib_upload] * 2,
                )

            with self.assertRaisesRegex(AttachmentValidationError, "50 MiB"):
                prepare_attachments(
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=uuid.uuid4(),
                    attachments=[three_mib_upload],
                )

    def test_deleted_upload_forms_still_count_toward_user_quota_until_expiry(self) -> None:
        upload = {"file_name": "image.png", "content_type": "image/png", "size": 1}
        presigned_post = {"url": "https://example.com/upload", "fields": {"policy": "abc"}}

        with (
            patch(
                "products.posthog_ai.backend.attachments.object_storage.get_presigned_post",
                return_value=presigned_post,
            ),
            patch("products.posthog_ai.backend.attachments.object_storage.delete"),
        ):
            for _ in range(20):
                conversation_id = uuid.uuid4()
                prepared = prepare_attachments(
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=conversation_id,
                    attachments=[upload],
                )
                delete_attachment(
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=conversation_id,
                    attachment_id=prepared[0].id,
                )

            with self.assertRaisesRegex(AttachmentValidationError, "up to 20 images"):
                prepare_attachments(
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=uuid.uuid4(),
                    attachments=[upload],
                )

    def test_finalize_rejects_upload_with_different_size_than_signed(self) -> None:
        content = self._png_bytes()
        attachment_id = "att-size-mismatch"
        self._seed_prepared_record(attachment_id, size=len(content) + 1)

        with (
            patch(
                "products.posthog_ai.backend.attachments.object_storage.read_object",
                return_value=(content, "image/png"),
            ),
            patch("products.posthog_ai.backend.attachments.object_storage.delete"),
        ):
            with self.assertRaisesRegex(AttachmentValidationError, "signed upload size"):
                finalize_attachments(
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=self.conversation_id,
                    attachment_id=attachment_id,
                )

    def test_finalize_waits_and_returns_idempotently(self) -> None:
        content = self._png_bytes()
        attachment_id = "att-1"
        self._seed_prepared_record(attachment_id, size=len(content))

        write_started = threading.Event()
        write_calls = 0
        write_lock = threading.Lock()

        def slow_write(*args, **kwargs):
            nonlocal write_calls
            with write_lock:
                write_calls += 1
            write_started.set()
            time.sleep(0.2)

        with (
            patch(
                "products.posthog_ai.backend.attachments.object_storage.read_object",
                return_value=(content, "image/png"),
            ),
            patch("products.posthog_ai.backend.attachments.object_storage.write", side_effect=slow_write),
            patch("products.posthog_ai.backend.attachments.object_storage.tag"),
            patch("products.posthog_ai.backend.attachments.object_storage.delete"),
        ):
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(
                    finalize_attachments,
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=self.conversation_id,
                    attachment_id=attachment_id,
                )
                self.assertTrue(write_started.wait(timeout=2))
                second = pool.submit(
                    finalize_attachments,
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=self.conversation_id,
                    attachment_id=attachment_id,
                )
                first_result = first.result(timeout=5)
                second_result = second.result(timeout=5)

        self.assertEqual(write_calls, 1)
        self.assertEqual(first_result.id, attachment_id)
        self.assertEqual(second_result.id, attachment_id)
        self.assertEqual(second_result.size, first_result.size)

    def test_finalize_tag_failure_deletes_normalized_object(self) -> None:
        content = self._png_bytes()
        attachment_id = "att-2"
        self._seed_prepared_record(attachment_id, size=len(content))
        normalized_path = _normalized_storage_path(
            self.team.id, self.user.id, self.conversation_id, attachment_id, "image/png"
        )

        with (
            patch(
                "products.posthog_ai.backend.attachments.object_storage.read_object",
                return_value=(content, "image/png"),
            ),
            patch("products.posthog_ai.backend.attachments.object_storage.write"),
            patch("products.posthog_ai.backend.attachments.object_storage.tag", side_effect=RuntimeError("tag failed")),
            patch("products.posthog_ai.backend.attachments.object_storage.delete") as m_delete,
        ):
            with self.assertRaises(AttachmentStorageError):
                finalize_attachments(
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=self.conversation_id,
                    attachment_id=attachment_id,
                )

        record = _get_record(attachment_id)
        assert record is not None
        self.assertEqual(record["status"], "prepared")
        deleted_paths = [call.args[0] for call in m_delete.call_args_list]
        self.assertIn(normalized_path, deleted_paths)

    @parameterized.expand(
        [
            ("png_declared_for_jpeg", "image/png", "jpeg"),
            ("jpeg_declared_for_png", "image/jpeg", "png"),
        ]
    )
    def test_image_validation_rejects_spoofed_content(self, _name: str, content_type: str, source_type: str) -> None:
        content = self._jpeg_bytes() if source_type == "jpeg" else self._png_bytes()

        with self.assertRaises(AttachmentValidationError):
            _validate_and_normalize_image(content, content_type)

    def test_image_validation_rejects_animated_png(self) -> None:
        first = Image.new("RGB", (2, 2), color="red")
        second = Image.new("RGB", (2, 2), color="blue")
        buffer = BytesIO()
        first.save(buffer, format="PNG", save_all=True, append_images=[second], duration=100)

        with self.assertRaisesRegex(AttachmentValidationError, "Animated images"):
            _validate_and_normalize_image(buffer.getvalue(), "image/png")

    def test_image_validation_rejects_twenty_megapixels(self) -> None:
        image = Image.new("1", (5_000, 4_000))
        buffer = BytesIO()
        image.save(buffer, format="PNG")

        with self.assertRaisesRegex(AttachmentValidationError, "fewer than 20 million pixels"):
            _validate_and_normalize_image(buffer.getvalue(), "image/png")

    def test_png_normalization_preserves_transparency_and_strips_metadata(self) -> None:
        image = Image.new("RGBA", (2, 3), color=(255, 0, 0, 64))
        metadata = PngImagePlugin.PngInfo()
        metadata.add_text("private", "remove me")
        buffer = BytesIO()
        image.save(buffer, format="PNG", pnginfo=metadata)

        normalized, width, height = _validate_and_normalize_image(buffer.getvalue(), "image/png")

        with Image.open(BytesIO(normalized)) as clean:
            self.assertEqual((width, height), (2, 3))
            self.assertEqual(clean.mode, "RGBA")
            self.assertEqual(clean.getpixel((0, 0)), (255, 0, 0, 64))
            self.assertNotIn("private", clean.info)

    def test_jpeg_normalization_applies_orientation_and_strips_metadata(self) -> None:
        image = Image.new("RGB", (2, 3), color="red")
        exif = Image.Exif()
        exif[274] = 6
        exif[315] = "private"
        buffer = BytesIO()
        image.save(buffer, format="JPEG", exif=exif)

        normalized, width, height = _validate_and_normalize_image(buffer.getvalue(), "image/jpeg")

        with Image.open(BytesIO(normalized)) as clean:
            self.assertEqual((width, height), (3, 2))
            self.assertEqual(clean.size, (3, 2))
            self.assertEqual(len(clean.getexif()), 0)

    def test_invalid_image_cleanup_removes_raw_object_and_staging_record(self) -> None:
        attachment_id = "att-invalid"
        content = self._jpeg_bytes()
        self._seed_prepared_record(attachment_id, size=len(content))
        raw_path = _raw_storage_path(self.team.id, self.user.id, self.conversation_id, attachment_id)

        with (
            patch(
                "products.posthog_ai.backend.attachments.object_storage.read_object",
                return_value=(content, "image/png"),
            ),
            patch("products.posthog_ai.backend.attachments.object_storage.delete") as delete,
        ):
            with self.assertRaises(AttachmentValidationError):
                finalize_attachments(
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=self.conversation_id,
                    attachment_id=attachment_id,
                )

        delete.assert_called_once_with(raw_path)
        record = _get_record(attachment_id)
        assert record is not None
        self.assertEqual(record["status"], "deleted")
        self.assertNotIn(
            attachment_id,
            _get_index(_conversation_index_key(self.team.id, self.user.id, self.conversation_id)),
        )
        self.assertIn(attachment_id, _get_index(_user_index_key(self.team.id, self.user.id)))

    def _promotion(self, attachment_id: str) -> AttachmentPromotion:
        return AttachmentPromotion(
            attachment_ids=[attachment_id],
            newly_attached_ids=[attachment_id],
            task_id="task-1",
            run_id="run-1",
            records=[
                {
                    "id": attachment_id,
                    "team_id": self.team.id,
                    "user_id": self.user.id,
                    "conversation_id": str(self.conversation_id),
                    "file_name": "image.png",
                    "content_type": "image/png",
                    "declared_size": 10,
                    "raw_storage_path": _raw_storage_path(
                        self.team.id, self.user.id, self.conversation_id, attachment_id
                    ),
                    "status": "finalized",
                }
            ],
        )

    def test_rollback_keeps_retryable_checkpoint_when_detach_fails(self) -> None:
        attachment_id = "att-3"
        self._seed_prepared_record(attachment_id, size=10)
        promotion = self._promotion(attachment_id)
        _write_records_and_indexes(
            records=[
                {**promotion.records[0], "status": "promoted", "promoted_task_id": "task-1", "promoted_run_id": "run-1"}
            ],
            team_id=self.team.id,
            user_id=self.user.id,
            conversation_id=self.conversation_id,
            conversation_ids=[],
            user_ids=[],
        )

        with patch(
            "products.posthog_ai.backend.attachments.tasks_facade.rollback_posthog_ai_attachments",
            side_effect=RuntimeError("detach failed"),
        ):
            rollback_attachment_promotion(promotion)

        self.assertNotIn(
            attachment_id,
            _get_index(_conversation_index_key(self.team.id, self.user.id, self.conversation_id)),
        )
        self.assertNotIn(attachment_id, _get_index(_user_index_key(self.team.id, self.user.id)))
        record = _get_record(attachment_id)
        assert record is not None
        self.assertEqual(record["status"], "rollback_pending")

    def test_rollback_checkpoint_failure_still_detaches_manifest(self) -> None:
        promotion = self._promotion("att-4")
        with (
            patch("products.posthog_ai.backend.attachments.tasks_facade.rollback_posthog_ai_attachments") as m_detach,
            patch(
                "products.posthog_ai.backend.attachments._cache_locks", side_effect=RuntimeError("cache lock failed")
            ),
            patch("products.posthog_ai.backend.attachments.logger.warning") as m_warning,
        ):
            rollback_attachment_promotion(promotion)

        m_detach.assert_called_once_with(
            task_id="task-1",
            run_id="run-1",
            team_id=self.team.id,
            attachment_ids=["att-4"],
        )
        warning_codes = [call.args[0] for call in m_warning.call_args_list]
        self.assertIn("assistant_attachment_rollback_checkpoint_failed", warning_codes)

    def test_promotion_cache_failure_preserves_original_error_when_detach_fails(self) -> None:
        attachment_id = "att-5"
        record = {
            **self._promotion(attachment_id).records[0],
            "normalized_storage_path": "normalized/image.png",
            "normalized_size": 10,
            "width": 2,
            "height": 5,
        }
        _write_records_and_indexes(
            records=[record],
            team_id=self.team.id,
            user_id=self.user.id,
            conversation_id=self.conversation_id,
            conversation_ids=[attachment_id],
            user_ids=[attachment_id],
        )
        cache_write_count = 0

        def fail_final_cache_write(**kwargs: Any) -> None:
            nonlocal cache_write_count
            cache_write_count += 1
            if cache_write_count == 1:
                _write_records_and_indexes(**kwargs)
                return
            raise RuntimeError("cache transition failed")

        with (
            patch(
                "products.posthog_ai.backend.attachments.tasks_facade.promote_posthog_ai_attachments",
                return_value=SimpleNamespace(attached_ids=[attachment_id], newly_attached_ids=[attachment_id]),
            ),
            patch(
                "products.posthog_ai.backend.attachments._write_records_and_indexes",
                side_effect=fail_final_cache_write,
            ),
            patch(
                "products.posthog_ai.backend.attachments.tasks_facade.rollback_posthog_ai_attachments",
                side_effect=RuntimeError("detach failed"),
            ),
            patch("products.posthog_ai.backend.attachments.logger.warning") as warning,
        ):
            with self.assertRaisesRegex(RuntimeError, "cache transition failed"):
                promote_attachments(
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=self.conversation_id,
                    task_id="task-1",
                    run_id="run-1",
                    attachment_ids=[attachment_id],
                )

        warning.assert_any_call(
            "assistant_attachment_promotion_rollback_failed",
            task_id="task-1",
            run_id="run-1",
            error="detach failed",
        )
        stored_record = _get_record(attachment_id)
        assert stored_record is not None
        self.assertEqual(stored_record["status"], "promotion_pending")
        self.assertNotIn(attachment_id, _get_index(_user_index_key(self.team.id, self.user.id)))

    def test_promotion_resumes_pending_rollback_before_reusing_attachment(self) -> None:
        attachment_id = str(uuid.uuid4())
        record = {
            **self._promotion(attachment_id).records[0],
            "normalized_storage_path": "normalized/image.png",
            "normalized_size": 10,
            "width": 2,
            "height": 5,
            "status": "rollback_pending",
            "promoted_task_id": "old-task",
            "promoted_run_id": "old-run",
        }
        _write_records_and_indexes(
            records=[record],
            team_id=self.team.id,
            user_id=self.user.id,
            conversation_id=self.conversation_id,
            conversation_ids=[],
            user_ids=[],
        )

        with (
            patch("products.posthog_ai.backend.attachments.tasks_facade.rollback_posthog_ai_attachments") as rollback,
            patch(
                "products.posthog_ai.backend.attachments.tasks_facade.promote_posthog_ai_attachments",
                return_value=SimpleNamespace(attached_ids=[attachment_id], newly_attached_ids=[attachment_id]),
            ),
        ):
            promotion = promote_attachments(
                team_id=self.team.id,
                user_id=self.user.id,
                conversation_id=self.conversation_id,
                task_id="new-task",
                run_id="new-run",
                attachment_ids=[attachment_id],
            )

        rollback.assert_called_once_with(
            task_id="old-task",
            run_id="old-run",
            team_id=self.team.id,
            attachment_ids=[attachment_id],
        )
        assert promotion is not None
        self.assertEqual(promotion.run_id, "new-run")

    def test_concurrent_promotion_cannot_send_one_attachment_to_two_runs(self) -> None:
        attachment_id = str(uuid.uuid4())
        record = {
            **self._promotion(attachment_id).records[0],
            "normalized_storage_path": "normalized/image.png",
            "normalized_size": 10,
            "width": 2,
            "height": 5,
        }
        _write_records_and_indexes(
            records=[record],
            team_id=self.team.id,
            user_id=self.user.id,
            conversation_id=self.conversation_id,
            conversation_ids=[attachment_id],
            user_ids=[attachment_id],
        )
        promotion_started = threading.Event()
        release_promotion = threading.Event()

        def slow_promotion(**_kwargs: object) -> SimpleNamespace:
            promotion_started.set()
            release_promotion.wait(timeout=5)
            return SimpleNamespace(attached_ids=[attachment_id], newly_attached_ids=[attachment_id])

        with patch(
            "products.posthog_ai.backend.attachments.tasks_facade.promote_posthog_ai_attachments",
            side_effect=slow_promotion,
        ) as promote:
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(
                    promote_attachments,
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=self.conversation_id,
                    task_id="task-1",
                    run_id="run-1",
                    attachment_ids=[attachment_id],
                )
                self.assertTrue(promotion_started.wait(timeout=2))
                second = pool.submit(
                    promote_attachments,
                    team_id=self.team.id,
                    user_id=self.user.id,
                    conversation_id=self.conversation_id,
                    task_id="task-1",
                    run_id="run-2",
                    attachment_ids=[attachment_id],
                )
                release_promotion.set()
                first_promotion = first.result(timeout=5)
                assert first_promotion is not None
                self.assertEqual(first_promotion.run_id, "run-1")
                with self.assertRaisesRegex(AttachmentValidationError, "another message"):
                    second.result(timeout=5)

        promote.assert_called_once()
