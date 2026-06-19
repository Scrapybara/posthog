import base64
from uuid import uuid4

from posthog.test.base import BaseTest
from unittest.mock import patch

from posthog.schema import HumanMessage, HumanMessageAttachment

from posthog.sync import database_sync_to_async

from products.posthog_ai.backend.attachments import InvalidConversationAttachment, load_attachment_blocks
from products.posthog_ai.backend.models import ConversationAttachment


class TestConversationAttachmentHydration(BaseTest):
    @database_sync_to_async
    def _create_attachment(self, conversation_id):
        return ConversationAttachment.objects.for_team(self.team.id).create(
            team=self.team,
            creator=self.user,
            conversation_id=conversation_id,
            file_name="image.png",
            content_type="image/png",
            size=3,
            width=1,
            height=1,
            object_path=f"private/{conversation_id}",
        )

    async def test_loads_scoped_attachment_as_transient_anthropic_block(self):
        conversation_id = uuid4()
        attachment = await self._create_attachment(conversation_id)
        message = HumanMessage(
            content="What is shown?",
            attachments=[
                HumanMessageAttachment(
                    id=str(attachment.id),
                    file_name="client-name-is-ignored.png",
                    content_type="image/jpeg",
                    size=999,
                    width=999,
                    height=999,
                )
            ],
        )
        with patch("products.posthog_ai.backend.attachments.object_storage.read_bytes", return_value=b"png"):
            blocks = await load_attachment_blocks(
                [message],
                team_id=self.team.id,
                creator_id=self.user.id,
                conversation_id=conversation_id,
            )
        self.assertEqual(
            blocks[id(message)],
            [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": base64.b64encode(b"png").decode("ascii"),
                    },
                }
            ],
        )

    async def test_rejects_user_and_conversation_mismatches(self):
        conversation_id = uuid4()
        attachment = await self._create_attachment(conversation_id)
        message = HumanMessage(
            content="",
            attachments=[
                HumanMessageAttachment(
                    id=str(attachment.id),
                    file_name=attachment.file_name,
                    content_type="image/png",
                    size=attachment.size,
                    width=attachment.width,
                    height=attachment.height,
                )
            ],
        )
        for creator_id, scoped_conversation_id in [
            (self.user.id + 1, conversation_id),
            (self.user.id, uuid4()),
        ]:
            with self.subTest(creator_id=creator_id, conversation_id=scoped_conversation_id):
                with self.assertRaises(InvalidConversationAttachment):
                    await load_attachment_blocks(
                        [message],
                        team_id=self.team.id,
                        creator_id=creator_id,
                        conversation_id=scoped_conversation_id,
                    )
