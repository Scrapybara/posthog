from posthog.test.base import BaseTest
from unittest.mock import patch

from posthog.schema import AssistantMessage, AssistantToolCallMessage, ContextMessage, FailureMessage, HumanMessage

from products.posthog_ai.backend.attachments import ResolvedAttachment

from ee.hogai.utils.openai import (
    convert_human_message_to_openai_message,
    convert_to_openai_message,
    convert_to_openai_messages,
)


class TestOpenAIUtils(BaseTest):
    @patch("ee.hogai.utils.openai.resolve_message_attachments")
    def test_convert_human_message_with_image_attachment(self, mock_resolve):
        image_data = b"jpeg-bytes"
        mock_resolve.return_value = [
            ResolvedAttachment(
                id="attachment-id",
                filename="screenshot.jpg",
                content_type="image/jpeg",
                byte_size=len(image_data),
                data=image_data,
            )
        ]
        message = HumanMessage(
            content="what is in this screenshot?",
            attachments=[
                {
                    "id": "attachment-id",
                    "conversation_id": "11111111-1111-4111-8111-111111111111",
                    "filename": "screenshot.jpg",
                    "content_type": "image/jpeg",
                    "byte_size": len(image_data),
                }
            ],
        )

        result = convert_human_message_to_openai_message(message, self.team)

        assert isinstance(result.content, list)
        self.assertEqual(result.content[0], {"type": "text", "text": "what is in this screenshot?"})
        self.assertEqual(
            result.content[1],
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,anBlZy1ieXRlcw=="}},
        )

    @patch("ee.hogai.utils.openai.resolve_message_attachments")
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
        message = HumanMessage(
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

        result = convert_human_message_to_openai_message(message, self.team)

        assert isinstance(result.content, list)
        self.assertEqual(result.content[0], {"type": "text", "text": "compare these screenshots"})
        self.assertEqual(result.content[1]["image_url"]["url"], "data:image/png;base64,Zmlyc3Q=")
        self.assertEqual(result.content[2]["image_url"]["url"], "data:image/jpeg;base64,c2Vjb25k")

    def test_convert_context_message_to_openai_message(self):
        message = ContextMessage(content="Context information")

        result = convert_to_openai_message(message, {})

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].content, "Context information")

    def test_convert_assistant_message_to_openai_message_without_tool_calls(self):
        message = AssistantMessage(content="Assistant response", id="asst_123", tool_calls=[])

        result = convert_to_openai_message(message, {})

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].content, "Assistant response")
        self.assertEqual(result[0].id, "asst_123")

    def test_convert_assistant_message_to_openai_message_with_tool_calls(self):
        message = AssistantMessage(
            content="Let me search for that",
            id="asst_456",
            tool_calls=[
                {"id": "tool_1", "name": "search", "args": {"query": "test"}},
                {"id": "tool_2", "name": "read_data", "args": {"id": 123}},
            ],
        )
        tool_result_map = {
            "tool_1": AssistantToolCallMessage(content="Search result", id="result_1", tool_call_id="tool_1"),
            "tool_2": AssistantToolCallMessage(content="Data content", id="result_2", tool_call_id="tool_2"),
        }

        result = convert_to_openai_message(message, tool_result_map)

        self.assertEqual(len(result), 3)
        self.assertEqual(result[0].content, "Let me search for that")
        self.assertEqual(len(result[0].tool_calls), 2)  # type: ignore
        self.assertEqual(result[1].content, "Search result")
        self.assertEqual(result[1].tool_call_id, "tool_1")  # type: ignore
        self.assertEqual(result[2].content, "Data content")
        self.assertEqual(result[2].tool_call_id, "tool_2")  # type: ignore

    def test_convert_assistant_message_filters_missing_tool_results(self):
        message = AssistantMessage(
            content="Processing",
            id="asst_789",
            tool_calls=[
                {"id": "tool_1", "name": "search", "args": {"query": "test"}},
                {"id": "tool_2", "name": "missing_tool", "args": {}},
            ],
        )
        tool_result_map = {
            "tool_1": AssistantToolCallMessage(content="Search result", id="result_1", tool_call_id="tool_1"),
        }

        result = convert_to_openai_message(message, tool_result_map)

        self.assertEqual(len(result), 2)
        self.assertEqual(len(result[0].tool_calls), 1)  # type: ignore
        self.assertEqual(result[0].tool_calls[0]["id"], "tool_1")  # type: ignore

    def test_convert_failure_message_to_openai_message(self):
        message = FailureMessage(content="Error occurred", id="fail_123")

        result = convert_to_openai_message(message, {})

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].content, "Error occurred")
        self.assertEqual(result[0].id, "fail_123")

    def test_convert_failure_message_with_no_content(self):
        message = FailureMessage(content=None, id="fail_456")

        result = convert_to_openai_message(message, {})

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].content, "An unknown failure occurred.")
        self.assertEqual(result[0].id, "fail_456")

    def test_convert_to_openai_messages_with_mixed_conversation(self):
        conversation = [
            HumanMessage(content="Hello", id="human_1"),
            AssistantMessage(
                content="Hi there",
                id="asst_1",
                tool_calls=[{"id": "tool_1", "name": "search", "args": {"query": "greeting"}}],
            ),
            HumanMessage(content="Follow up", id="human_2"),
            AssistantMessage(content="Response", id="asst_2", tool_calls=[]),
            FailureMessage(content="Error", id="fail_1"),
        ]
        tool_result_map = {
            "tool_1": AssistantToolCallMessage(content="Search done", id="result_1", tool_call_id="tool_1"),
        }

        result = convert_to_openai_messages(conversation, tool_result_map)  # type: ignore

        self.assertEqual(len(result), 6)
        self.assertEqual(result[0].content, "Hello")
        self.assertEqual(result[1].content, "Hi there")
        self.assertEqual(result[2].content, "Search done")
        self.assertEqual(result[3].content, "Follow up")
        self.assertEqual(result[4].content, "Response")
        self.assertEqual(result[5].content, "Error")

    def test_convert_to_openai_messages_handles_context_messages(self):
        conversation = [
            ContextMessage(content="System context"),
            HumanMessage(content="User question", id="human_1"),
            AssistantMessage(content="Answer", id="asst_1", tool_calls=[]),
        ]

        result = convert_to_openai_messages(conversation, {})  # type: ignore

        self.assertEqual(len(result), 3)
        self.assertEqual(result[0].content, "System context")
        self.assertEqual(result[1].content, "User question")
        self.assertEqual(result[2].content, "Answer")

    def test_convert_to_openai_messages_skips_unknown_message_types(self):
        conversation = [
            HumanMessage(content="Hello", id="human_1"),
            AssistantMessage(content="Response", id="asst_1", tool_calls=[]),
        ]

        result = convert_to_openai_messages(conversation, {})  # type: ignore

        self.assertEqual(len(result), 2)
