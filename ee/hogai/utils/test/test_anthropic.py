from posthog.test.base import BaseTest
from unittest.mock import patch

from langchain_core.messages import HumanMessage
from parameterized import parameterized

from posthog.schema import (
    AssistantMessage,
    AssistantMessageMetadata,
    HumanMessage as SchemaHumanMessage,
)

from products.posthog_ai.backend.attachments import ResolvedAttachment

from ee.hogai.utils.anthropic import (
    add_cache_control,
    convert_assistant_message_to_anthropic_message,
    convert_human_message_to_anthropic_message,
    get_anthropic_thinking_from_assistant_message,
)


class TestAnthropicUtils(BaseTest):
    @parameterized.expand(
        [
            (None, []),
            (AssistantMessageMetadata(thinking=None), []),
            (AssistantMessageMetadata(thinking=[]), []),
            (
                AssistantMessageMetadata(thinking=[{"type": "thinking", "content": "test"}]),
                [{"type": "thinking", "content": "test"}],
            ),
            (
                AssistantMessageMetadata(
                    thinking=[
                        {"type": "thinking", "content": "first"},
                        {"type": "redacted_thinking", "content": "second"},
                    ]
                ),
                [{"type": "thinking", "content": "first"}, {"type": "redacted_thinking", "content": "second"}],
            ),
        ]
    )
    def test_get_thinking_from_assistant_message(self, meta, expected):
        """Test extracting thinking from AssistantMessage"""
        message = AssistantMessage(content="test", meta=meta)

        result = get_anthropic_thinking_from_assistant_message(message)

        self.assertEqual(result, expected)

        # Verify it returns a copy, not the original
        if expected:
            self.assertIsNot(result, meta.thinking)

    def test_add_cache_control_string_content(self):
        """Test adding cache control to message with string content"""
        message = HumanMessage(content="Test message")

        result = add_cache_control(message)

        self.assertIs(result, message)  # Should modify in place
        assert isinstance(message.content, list)
        self.assertEqual(len(message.content), 1)
        assert isinstance(message.content[0], dict)
        self.assertEqual(message.content[0]["type"], "text")
        self.assertEqual(message.content[0]["text"], "Test message")
        self.assertEqual(message.content[0]["cache_control"], {"type": "ephemeral", "ttl": "5m"})

    def test_add_cache_control_list_content_with_string_last(self):
        """Test adding cache control to message with list content ending in string"""
        message = HumanMessage(
            content=[
                {"type": "text", "text": "First part"},
                "Second part as string",
            ]
        )

        result = add_cache_control(message)

        self.assertIs(result, message)
        assert isinstance(message.content, list)
        self.assertEqual(len(message.content), 2)
        # First part unchanged
        assert isinstance(message.content[0], dict)
        self.assertEqual(message.content[0]["type"], "text")
        self.assertEqual(message.content[0]["text"], "First part")
        self.assertNotIn("cache_control", message.content[0])

        # Last part converted and cache control added
        assert isinstance(message.content[1], dict)
        self.assertEqual(message.content[1]["type"], "text")
        self.assertEqual(message.content[1]["text"], "Second part as string")
        self.assertEqual(message.content[1]["cache_control"], {"type": "ephemeral", "ttl": "5m"})

    def test_add_cache_control_list_content_with_dict_last(self):
        """Test adding cache control to message with list content ending in dict"""
        message = HumanMessage(
            content=[
                {"type": "text", "text": "First part"},
                {"type": "image", "url": "http://example.com/image.jpg"},
            ]
        )

        result = add_cache_control(message)

        self.assertIs(result, message)
        assert isinstance(message.content, list)
        self.assertEqual(len(message.content), 2)
        # First part unchanged
        assert isinstance(message.content[0], dict)
        self.assertNotIn("cache_control", message.content[0])

        # Last part gets cache control added
        assert isinstance(message.content[1], dict)
        self.assertEqual(message.content[1]["type"], "image")
        self.assertEqual(message.content[1]["url"], "http://example.com/image.jpg")
        self.assertEqual(message.content[1]["cache_control"], {"type": "ephemeral", "ttl": "5m"})

    @parameterized.expand(
        [
            ("no_source", None, "Original content", None),
            ("slash_command_usage", "slash_command:usage", "Current conversation: 5 credits", "usage"),
            ("slash_command_remember", "slash_command:remember", "Saved memory", "remember"),
            ("unknown_source", "unknown_source", "Original content", None),
        ]
    )
    def test_convert_assistant_message_provenance_note(self, _name, source, content_text, expected_command):
        meta = AssistantMessageMetadata(source=source) if source else None
        message = AssistantMessage(content=content_text, id="1", meta=meta)
        result = convert_assistant_message_to_anthropic_message(message, {})

        # Assistant text is never modified — only a follow-up HumanMessage is appended when there's a slash-command source.
        ai_message = result[0]
        ai_content = ai_message.content
        assert isinstance(ai_content, list)
        assert isinstance(ai_content[0], dict)
        self.assertEqual(ai_content[0], {"type": "text", "text": content_text})

        if expected_command is not None:
            self.assertEqual(len(result), 2)
            provenance_message = result[1]
            self.assertIsInstance(provenance_message, HumanMessage)
            provenance_content = provenance_message.content
            assert isinstance(provenance_content, list)
            assert isinstance(provenance_content[0], dict)
            provenance_text = provenance_content[0]["text"]
            self.assertIn(f"/{expected_command} slash command", provenance_text)
            self.assertIn("deterministic PostHog code", provenance_text)
        else:
            self.assertEqual(len(result), 1)

    @patch("ee.hogai.utils.anthropic.resolve_message_attachments")
    def test_convert_human_message_with_image_attachment(self, mock_resolve):
        image_data = b"png-bytes"
        mock_resolve.return_value = [
            ResolvedAttachment(
                id="attachment-id",
                filename="screenshot.png",
                content_type="image/png",
                byte_size=len(image_data),
                data=image_data,
            )
        ]
        message = SchemaHumanMessage(
            content="what is in this screenshot?",
            attachments=[
                {
                    "id": "attachment-id",
                    "conversation_id": "11111111-1111-4111-8111-111111111111",
                    "filename": "screenshot.png",
                    "content_type": "image/png",
                    "byte_size": len(image_data),
                }
            ],
        )

        result = convert_human_message_to_anthropic_message(message, self.team)

        assert isinstance(result.content, list)
        self.assertEqual(result.content[0], {"type": "text", "text": "what is in this screenshot?"})
        self.assertEqual(result.content[1]["type"], "image")
        self.assertEqual(result.content[1]["source"]["media_type"], "image/png")
        self.assertEqual(result.content[1]["source"]["data"], "cG5nLWJ5dGVz")

    @patch("ee.hogai.utils.anthropic.resolve_message_attachments")
    def test_convert_human_message_preserves_multiple_image_attachment_order(self, mock_resolve):
        mock_resolve.return_value = [
            ResolvedAttachment(
                id="first-attachment-id",
                filename="first.png",
                content_type="image/png",
                byte_size=5,
                data=b"first",
            ),
            ResolvedAttachment(
                id="second-attachment-id",
                filename="second.jpg",
                content_type="image/jpeg",
                byte_size=6,
                data=b"second",
            ),
        ]
        message = SchemaHumanMessage(
            content="compare these screenshots",
            attachments=[
                {
                    "id": "first-attachment-id",
                    "conversation_id": "11111111-1111-4111-8111-111111111111",
                    "filename": "first.png",
                    "content_type": "image/png",
                    "byte_size": 5,
                },
                {
                    "id": "second-attachment-id",
                    "conversation_id": "11111111-1111-4111-8111-111111111111",
                    "filename": "second.jpg",
                    "content_type": "image/jpeg",
                    "byte_size": 6,
                },
            ],
        )

        result = convert_human_message_to_anthropic_message(message, self.team)

        assert isinstance(result.content, list)
        self.assertEqual(result.content[0], {"type": "text", "text": "compare these screenshots"})
        self.assertEqual(result.content[1]["source"]["data"], "Zmlyc3Q=")
        self.assertEqual(result.content[2]["source"]["data"], "c2Vjb25k")
