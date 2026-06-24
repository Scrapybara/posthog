from base64 import b64encode
from datetime import timedelta
from io import BytesIO

from posthog.test.base import APIBaseTest
from unittest.mock import call, patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone

from PIL import Image
from rest_framework import status

from posthog.models.user import User

from products.posthog_ai.backend.attachments import cleanup_abandoned_pending_attachments, resolve_message_attachments
from products.posthog_ai.backend.models.assistant import Conversation, ConversationAttachment


def _image_bytes(image_format: str = "PNG") -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (1, 1), color=(255, 0, 0)).save(buffer, format=image_format)
    return buffer.getvalue()


class TestConversationAttachmentAPI(APIBaseTest):
    def setUp(self) -> None:
        super().setUp()
        self.other_user = User.objects.create_and_join(
            organization=self.organization,
            email="other@example.com",
            password="password",
            first_name="Other",
        )

    @override_settings(OBJECT_STORAGE_ENABLED=True)
    @patch("products.posthog_ai.backend.attachments.object_storage.write")
    def test_upload_png_attachment_stores_private_object_reference(self, mock_write) -> None:
        conversation_id = "11111111-1111-4111-8111-111111111111"
        response = self.client.post(
            f"/api/projects/{self.team.id}/conversation_attachments/",
            {
                "conversation_id": conversation_id,
                "file": SimpleUploadedFile("..\\screenshot.png", _image_bytes(), content_type="image/png"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(set(response.json()), {"id", "filename", "content_type", "byte_size"})
        self.assertEqual(response.json()["filename"], "screenshot.png")
        self.assertEqual(response.json()["content_type"], "image/png")

        attachment = ConversationAttachment.objects.unscoped().get(id=response.json()["id"])
        self.assertEqual(attachment.team_id, self.team.id)
        self.assertEqual(str(attachment.conversation_id), conversation_id)
        self.assertEqual(attachment.created_by, self.user)
        self.assertNotIn("object_key", response.json())
        mock_write.assert_called_once()
        self.assertEqual(mock_write.call_args.kwargs["extras"], {"ContentType": "image/png"})

    @override_settings(OBJECT_STORAGE_ENABLED=True)
    @patch("products.posthog_ai.backend.attachments.object_storage.write")
    def test_upload_detects_jpeg_from_file_signature(self, mock_write) -> None:
        response = self.client.post(
            f"/api/projects/{self.team.id}/conversation_attachments/",
            {
                "conversation_id": "11111111-1111-4111-8111-111111111111",
                "file": SimpleUploadedFile("screenshot.png", _image_bytes("JPEG"), content_type="image/png"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.json()["content_type"], "image/jpeg")
        self.assertEqual(mock_write.call_args.kwargs["extras"], {"ContentType": "image/jpeg"})

    @override_settings(OBJECT_STORAGE_ENABLED=True)
    def test_upload_rejects_non_image_content(self) -> None:
        response = self.client.post(
            f"/api/projects/{self.team.id}/conversation_attachments/",
            {
                "conversation_id": "11111111-1111-4111-8111-111111111111",
                "file": SimpleUploadedFile("screenshot.png", b"not an image", content_type="image/png"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(ConversationAttachment.objects.unscoped().count(), 0)

    @override_settings(OBJECT_STORAGE_ENABLED=True)
    @patch("products.posthog_ai.backend.attachments.object_storage.write")
    @patch("products.posthog_ai.backend.attachments.Image.open")
    def test_upload_rejects_pillow_decompression_bombs(self, mock_open, mock_write) -> None:
        mock_open.side_effect = Image.DecompressionBombError("too many pixels")

        response = self.client.post(
            f"/api/projects/{self.team.id}/conversation_attachments/",
            {
                "conversation_id": "11111111-1111-4111-8111-111111111111",
                "file": SimpleUploadedFile("screenshot.png", _image_bytes(), content_type="image/png"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(ConversationAttachment.objects.unscoped().count(), 0)
        mock_write.assert_not_called()

    @override_settings(OBJECT_STORAGE_ENABLED=True)
    def test_upload_rejects_existing_conversation_owned_by_other_user(self) -> None:
        conversation = Conversation.objects.create(user=self.other_user, team=self.team)

        response = self.client.post(
            f"/api/projects/{self.team.id}/conversation_attachments/",
            {
                "conversation_id": str(conversation.id),
                "file": SimpleUploadedFile("screenshot.png", _image_bytes(), content_type="image/png"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(ConversationAttachment.objects.unscoped().count(), 0)

    @override_settings(OBJECT_STORAGE_ENABLED=True)
    def test_upload_rejects_large_files_before_storage(self) -> None:
        response = self.client.post(
            f"/api/projects/{self.team.id}/conversation_attachments/",
            {
                "conversation_id": "11111111-1111-4111-8111-111111111111",
                "file": SimpleUploadedFile(
                    "screenshot.png",
                    b"\x89PNG\r\n\x1a\n" + (b"0" * (4 * 1024 * 1024 + 1)),
                    content_type="image/png",
                ),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(ConversationAttachment.objects.unscoped().count(), 0)

    @override_settings(OBJECT_STORAGE_ENABLED=True)
    @patch("products.posthog_ai.backend.attachments.object_storage.write")
    def test_upload_rejects_too_many_pending_attachments_before_storage(self, mock_write) -> None:
        conversation_id = "11111111-1111-4111-8111-111111111111"
        for index in range(4):
            ConversationAttachment.objects.unscoped().create(
                team=self.team,
                conversation_id=conversation_id,
                created_by=self.user,
                original_filename=f"screenshot-{index}.png",
                content_type="image/png",
                byte_size=123,
                object_key=f"private/key-{index}.png",
            )

        response = self.client.post(
            f"/api/projects/{self.team.id}/conversation_attachments/",
            {
                "conversation_id": conversation_id,
                "file": SimpleUploadedFile("screenshot.png", _image_bytes(), content_type="image/png"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()["attr"], "file")
        self.assertIn("You can attach up to 4 images.", response.json()["detail"])
        mock_write.assert_not_called()

    @override_settings(OBJECT_STORAGE_ENABLED=True)
    @patch("products.posthog_ai.backend.attachments.object_storage.write")
    def test_upload_rejects_pending_total_size_before_storage(self, mock_write) -> None:
        conversation_id = "11111111-1111-4111-8111-111111111111"
        for index in range(3):
            ConversationAttachment.objects.unscoped().create(
                team=self.team,
                conversation_id=conversation_id,
                created_by=self.user,
                original_filename=f"screenshot-{index}.png",
                content_type="image/png",
                byte_size=4 * 1024 * 1024,
                object_key=f"private/key-{index}.png",
            )

        response = self.client.post(
            f"/api/projects/{self.team.id}/conversation_attachments/",
            {
                "conversation_id": conversation_id,
                "file": SimpleUploadedFile("screenshot.png", _image_bytes(), content_type="image/png"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()["attr"], "file")
        self.assertIn("Images must be 12 MiB or smaller in total.", response.json()["detail"])
        mock_write.assert_not_called()

    @override_settings(OBJECT_STORAGE_ENABLED=True)
    @patch("products.posthog_ai.backend.attachments.object_storage.delete")
    def test_delete_attachment_removes_private_object_and_soft_deletes_row(self, mock_delete) -> None:
        attachment = ConversationAttachment.objects.unscoped().create(
            team=self.team,
            conversation_id="11111111-1111-4111-8111-111111111111",
            created_by=self.user,
            original_filename="screenshot.png",
            content_type="image/png",
            byte_size=123,
            object_key="private/key.png",
        )

        response = self.client.delete(f"/api/projects/{self.team.id}/conversation_attachments/{attachment.id}/")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        mock_delete.assert_called_once_with("private/key.png")
        attachment.refresh_from_db()
        self.assertTrue(attachment.deleted)
        self.assertEqual(attachment.deleted_by, self.user)

    @override_settings(OBJECT_STORAGE_ENABLED=True)
    @patch("products.posthog_ai.backend.attachments.object_storage.delete")
    def test_delete_does_not_remove_sent_attachment(self, mock_delete) -> None:
        attachment = ConversationAttachment.objects.unscoped().create(
            team=self.team,
            conversation_id="11111111-1111-4111-8111-111111111111",
            created_by=self.user,
            original_filename="screenshot.png",
            content_type="image/png",
            byte_size=123,
            object_key="private/key.png",
            attachment_status=ConversationAttachment.AttachmentStatus.ATTACHED,
        )

        response = self.client.delete(f"/api/projects/{self.team.id}/conversation_attachments/{attachment.id}/")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        mock_delete.assert_not_called()
        attachment.refresh_from_db()
        self.assertFalse(attachment.deleted)

    @patch("products.posthog_ai.backend.attachments.object_storage.delete_objects", return_value=[])
    def test_cleanup_abandoned_pending_attachments_deletes_old_pending_objects(self, mock_delete_objects) -> None:
        old_attachment = ConversationAttachment.objects.unscoped().create(
            team=self.team,
            conversation_id="11111111-1111-4111-8111-111111111111",
            created_by=self.user,
            original_filename="old.png",
            content_type="image/png",
            byte_size=123,
            object_key="old/key.png",
        )
        ConversationAttachment.objects.unscoped().filter(id=old_attachment.id).update(
            created_at=timezone.now() - timedelta(hours=25)
        )
        ConversationAttachment.objects.unscoped().create(
            team=self.team,
            conversation_id="11111111-1111-4111-8111-111111111111",
            created_by=self.user,
            original_filename="new.png",
            content_type="image/png",
            byte_size=123,
            object_key="new/key.png",
        )

        deleted_count = cleanup_abandoned_pending_attachments()

        self.assertEqual(deleted_count, 1)
        mock_delete_objects.assert_called_once_with(["old/key.png"])
        old_attachment.refresh_from_db()
        self.assertTrue(old_attachment.deleted)

    @patch("products.posthog_ai.backend.attachments.object_storage.read_bytes")
    def test_resolve_message_attachments_reads_private_object_bytes_in_reference_order(self, mock_read_bytes) -> None:
        image = _image_bytes()
        other_image = _image_bytes("JPEG")
        mock_read_bytes.side_effect = lambda object_key: {
            "private/first.png": image,
            "private/second.jpg": other_image,
        }[object_key]
        first_attachment = ConversationAttachment.objects.unscoped().create(
            team=self.team,
            conversation_id="11111111-1111-4111-8111-111111111111",
            created_by=self.user,
            original_filename="screenshot.png",
            content_type="image/png",
            byte_size=len(image),
            object_key="private/first.png",
        )
        second_attachment = ConversationAttachment.objects.unscoped().create(
            team=self.team,
            conversation_id="11111111-1111-4111-8111-111111111111",
            created_by=self.user,
            original_filename="other.jpg",
            content_type="image/jpeg",
            byte_size=len(other_image),
            object_key="private/second.jpg",
        )

        resolved = resolve_message_attachments(
            team=self.team,
            attachment_refs=[
                {
                    "id": str(second_attachment.id),
                    "conversation_id": str(second_attachment.conversation_id),
                },
                {
                    "id": str(first_attachment.id),
                    "conversation_id": str(first_attachment.conversation_id),
                },
            ],
        )

        self.assertEqual(
            [attachment.id for attachment in resolved], [str(second_attachment.id), str(first_attachment.id)]
        )
        self.assertEqual(resolved[0].data, other_image)
        self.assertEqual(resolved[1].data, image)
        mock_read_bytes.assert_has_calls([call("private/second.jpg"), call("private/first.png")])
        self.assertEqual(
            resolved[1].as_anthropic_block()["source"],
            {"type": "base64", "media_type": "image/png", "data": b64encode(image).decode("ascii")},
        )
