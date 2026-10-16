import uuid

from posthog.test.base import APIBaseTest
from unittest.mock import patch

from rest_framework import status

from posthog.models import Team

from products.posthog_ai.backend.attachments import AttachmentNotFoundError, FinalizedAttachment, PreparedAttachment
from products.posthog_ai.backend.models.assistant import Conversation


class TestAssistantAttachmentsViewSet(APIBaseTest):
    def _url(self, action: str) -> str:
        return f"/api/projects/{self.team.id}/assistant_attachments/{action}/"

    def _conversation(self, *, runtime: str = Conversation.AgentRuntime.SANDBOX) -> Conversation:
        return Conversation.objects.create(
            user=self.user,
            team=self.team,
            agent_runtime=runtime,
            type=Conversation.Type.ASSISTANT,
        )

    def test_prepare_uses_flat_upload_contract(self) -> None:
        conversation = self._conversation()
        prepared = PreparedAttachment(
            id=str(uuid.uuid4()),
            file_name="image.png",
            content_type="image/png",
            size=123,
            upload_url="https://example.com/upload",
            upload_fields={"key": "value"},
        )
        with patch("products.posthog_ai.backend.api.attachments.prepare_attachments", return_value=[prepared]):
            response = self.client.post(
                self._url("prepare"),
                {
                    "conversation_id": str(conversation.id),
                    "attachments": [{"file_name": "image.png", "content_type": "image/png", "size": 123}],
                },
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.json(),
            {
                "attachments": [
                    {
                        "id": prepared.id,
                        "file_name": "image.png",
                        "content_type": "image/png",
                        "size": 123,
                        "upload_url": "https://example.com/upload",
                        "upload_fields": {"key": "value"},
                    }
                ]
            },
        )

    def test_finalize_uses_single_attachment_contract(self) -> None:
        conversation = self._conversation()
        finalized = FinalizedAttachment(
            id=str(uuid.uuid4()),
            file_name="image.png",
            content_type="image/png",
            size=120,
            width=10,
            height=12,
        )
        with patch(
            "products.posthog_ai.backend.api.attachments.finalize_attachments", return_value=finalized
        ) as m_finalize:
            response = self.client.post(
                self._url("finalize"),
                {
                    "conversation_id": str(conversation.id),
                    "attachment_id": finalized.id,
                },
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.json(),
            {
                "id": finalized.id,
                "file_name": "image.png",
                "content_type": "image/png",
                "size": 120,
                "width": 10,
                "height": 12,
            },
        )
        self.assertEqual(m_finalize.call_args.kwargs["attachment_id"], finalized.id)

    def test_delete_is_idempotent_when_attachment_is_already_absent(self) -> None:
        conversation = self._conversation()
        with patch(
            "products.posthog_ai.backend.api.attachments.delete_attachment",
            side_effect=AttachmentNotFoundError("Attachment not found"),
        ):
            response = self.client.post(
                self._url("delete"),
                {
                    "conversation_id": str(conversation.id),
                    "attachment_id": str(uuid.uuid4()),
                },
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_existing_langgraph_conversation_is_rejected(self) -> None:
        conversation = self._conversation(runtime=Conversation.AgentRuntime.LANGGRAPH)
        response = self.client.post(
            self._url("prepare"),
            {
                "conversation_id": str(conversation.id),
                "attachments": [{"file_name": "image.png", "content_type": "image/png", "size": 123}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()["detail"], "This conversation is not on the sandbox runtime.")

    def test_other_users_conversation_is_rejected_before_preparing_upload(self) -> None:
        conversation = Conversation.objects.create(
            user=self._create_user("other-user@posthog.com"),
            team=self.team,
            agent_runtime=Conversation.AgentRuntime.SANDBOX,
            type=Conversation.Type.ASSISTANT,
        )

        with patch("products.posthog_ai.backend.api.attachments.prepare_attachments") as prepare:
            response = self.client.post(
                self._url("prepare"),
                {
                    "conversation_id": str(conversation.id),
                    "attachments": [{"file_name": "image.png", "content_type": "image/png", "size": 123}],
                },
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        prepare.assert_not_called()

    def test_other_teams_conversation_is_rejected_before_preparing_upload(self) -> None:
        other_team = Team.objects.create(organization=self.organization, name="Other project")
        conversation = Conversation.objects.create(
            user=self.user,
            team=other_team,
            agent_runtime=Conversation.AgentRuntime.SANDBOX,
            type=Conversation.Type.ASSISTANT,
        )

        with patch("products.posthog_ai.backend.api.attachments.prepare_attachments") as prepare:
            response = self.client.post(
                self._url("prepare"),
                {
                    "conversation_id": str(conversation.id),
                    "attachments": [{"file_name": "image.png", "content_type": "image/png", "size": 123}],
                },
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        prepare.assert_not_called()

    def test_deleted_conversation_is_rejected_before_preparing_upload(self) -> None:
        conversation = self._conversation()
        conversation.deleted = True
        conversation.save(update_fields=["deleted"])

        with patch("products.posthog_ai.backend.api.attachments.prepare_attachments") as prepare:
            response = self.client.post(
                self._url("prepare"),
                {
                    "conversation_id": str(conversation.id),
                    "attachments": [{"file_name": "image.png", "content_type": "image/png", "size": 123}],
                },
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        prepare.assert_not_called()
