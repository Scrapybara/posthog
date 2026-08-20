from __future__ import annotations

import uuid
from typing import Any, cast

from drf_spectacular.utils import OpenApiResponse
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from posthog.api.mixins import ValidatedRequest, validated_request
from posthog.api.routing import TeamAndOrgViewSetMixin
from posthog.models.user import User

from products.posthog_ai.backend.attachments import (
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENT_COUNT,
    AttachmentNotFoundError,
    AttachmentStorageError,
    AttachmentValidationError,
    delete_attachment,
    finalize_attachments,
    prepare_attachments,
)
from products.posthog_ai.backend.models.assistant import Conversation

from ee.hogai.utils.feature_flags import has_sandbox_mode_feature_flag


class AttachmentPrepareItemSerializer(serializers.Serializer):
    file_name = serializers.CharField(max_length=255, help_text="File name to associate with the uploaded image.")
    size = serializers.IntegerField(
        min_value=1,
        max_value=MAX_ATTACHMENT_BYTES,
        help_text=f"Expected upload size in bytes. Each image must be {MAX_ATTACHMENT_BYTES} bytes or smaller.",
    )
    content_type = serializers.ChoiceField(
        choices=["image/png", "image/jpeg"],
        help_text="Exact MIME type for the direct upload. Only PNG and JPEG are supported.",
    )


class AttachmentPrepareRequestSerializer(serializers.Serializer):
    conversation_id = serializers.UUIDField(help_text="Conversation UUID the staged image attachments belong to.")
    attachments = serializers.ListField(
        child=AttachmentPrepareItemSerializer(),
        min_length=1,
        max_length=MAX_ATTACHMENT_COUNT,
        help_text="Images to stage for the next sandbox message.",
    )


class AttachmentPrepareResponseItemSerializer(serializers.Serializer):
    id = serializers.UUIDField(help_text="Opaque attachment ID for finalize, delete, and sandbox message sends.")
    file_name = serializers.CharField(help_text="Sanitized file name recorded for the image attachment.")
    content_type = serializers.ChoiceField(
        choices=["image/png", "image/jpeg"],
        help_text="Signed MIME type for the upload.",
    )
    size = serializers.IntegerField(help_text="Expected upload size in bytes.")
    upload_url = serializers.URLField(help_text="Signed direct-upload URL for the image attachment.")
    upload_fields = serializers.DictField(
        child=serializers.CharField(),
        help_text="Signed S3-compatible form fields to include with the upload request.",
    )


class AttachmentPrepareResponseSerializer(serializers.Serializer):
    attachments = AttachmentPrepareResponseItemSerializer(many=True, help_text="Prepared image uploads.")


class AttachmentFinalizeRequestSerializer(serializers.Serializer):
    conversation_id = serializers.UUIDField(help_text="Conversation UUID the uploaded image attachment belongs to.")
    attachment_id = serializers.UUIDField(help_text="Prepared attachment ID to validate and finalize for sandbox use.")


class AttachmentFinalizeResponseSerializer(serializers.Serializer):
    id = serializers.UUIDField(help_text="Opaque attachment ID for sandbox message sends.")
    file_name = serializers.CharField(help_text="Sanitized file name recorded for the image attachment.")
    content_type = serializers.ChoiceField(
        choices=["image/png", "image/jpeg"],
        help_text="Validated MIME type for the normalized image.",
    )
    size = serializers.IntegerField(help_text="Normalized image size in bytes.")
    width = serializers.IntegerField(help_text="Normalized image width in pixels.")
    height = serializers.IntegerField(help_text="Normalized image height in pixels.")


class AttachmentDeleteRequestSerializer(serializers.Serializer):
    conversation_id = serializers.UUIDField(help_text="Conversation UUID the image attachment belongs to.")
    attachment_id = serializers.UUIDField(help_text="Single attachment ID to delete from staging.")


class AssistantAttachmentsViewSet(TeamAndOrgViewSetMixin, GenericViewSet):
    scope_object = "conversation"
    serializer_class = AttachmentPrepareRequestSerializer

    def _resolve_conversation(self, request: Request, conversation_id: uuid.UUID) -> None:
        user = cast(User, request.user)
        conversation = (
            Conversation.objects.filter(id=conversation_id)
            .only("team_id", "user_id", "deleted", "agent_runtime")
            .first()
        )
        if conversation is None:
            if not has_sandbox_mode_feature_flag(self.team, user):
                raise ValidationError("This conversation is not on the sandbox runtime.")
            return
        if conversation.deleted:
            raise NotFound("Conversation not found.")
        if conversation.team_id != self.team.id or conversation.user_id != user.id:
            raise PermissionDenied("Cannot access other users' conversations")
        if conversation.agent_runtime != Conversation.AgentRuntime.SANDBOX:
            raise ValidationError("This conversation is not on the sandbox runtime.")

    @validated_request(
        request_serializer=AttachmentPrepareRequestSerializer,
        responses={
            200: OpenApiResponse(response=AttachmentPrepareResponseSerializer, description="Prepared image uploads."),
            400: OpenApiResponse(description="Invalid image attachment payload."),
        },
        operation_id="assistantAttachmentsPrepareCreate",
        summary="Prepare sandbox image uploads",
        description="Reserve direct-upload image attachment slots for a sandbox conversation and return signed POST fields.",
        strict_request_validation=True,
    )
    @action(detail=False, methods=["post"], url_path="prepare", required_scopes=["project:write"])
    def prepare(self, request: ValidatedRequest, *args: Any, **kwargs: Any) -> Response:
        data = cast(dict[str, Any], request.validated_data)
        conversation_id = data["conversation_id"]
        self._resolve_conversation(request, conversation_id)
        try:
            prepared = prepare_attachments(
                team_id=self.team.id,
                user_id=cast(User, request.user).id,
                conversation_id=conversation_id,
                attachments=data["attachments"],
            )
        except AttachmentValidationError as error:
            raise ValidationError(str(error)) from error
        except AttachmentStorageError as error:
            raise ValidationError(str(error)) from error
        serializer = AttachmentPrepareResponseSerializer(
            {
                "attachments": [
                    {
                        "id": item.id,
                        "file_name": item.file_name,
                        "content_type": item.content_type,
                        "size": item.size,
                        "upload_url": item.upload_url,
                        "upload_fields": item.upload_fields,
                    }
                    for item in prepared
                ]
            }
        )
        return Response(serializer.data)

    @validated_request(
        request_serializer=AttachmentFinalizeRequestSerializer,
        responses={
            200: OpenApiResponse(
                response=AttachmentFinalizeResponseSerializer, description="Finalized image attachment."
            ),
            400: OpenApiResponse(description="Invalid image attachment payload."),
        },
        operation_id="assistantAttachmentsFinalizeCreate",
        summary="Finalize sandbox image uploads",
        description="Validate, normalize, and finalize one staged image upload for sandbox messages.",
        strict_request_validation=True,
    )
    @action(detail=False, methods=["post"], url_path="finalize", required_scopes=["project:write"])
    def finalize(self, request: ValidatedRequest, *args: Any, **kwargs: Any) -> Response:
        data = cast(dict[str, Any], request.validated_data)
        conversation_id = data["conversation_id"]
        self._resolve_conversation(request, conversation_id)
        try:
            finalized = finalize_attachments(
                team_id=self.team.id,
                user_id=cast(User, request.user).id,
                conversation_id=conversation_id,
                attachment_id=str(data["attachment_id"]),
            )
        except AttachmentNotFoundError as error:
            raise NotFound(str(error)) from error
        except AttachmentValidationError as error:
            raise ValidationError(str(error)) from error
        except AttachmentStorageError as error:
            raise ValidationError(str(error)) from error
        serializer = AttachmentFinalizeResponseSerializer(
            {
                "id": finalized.id,
                "file_name": finalized.file_name,
                "content_type": finalized.content_type,
                "size": finalized.size,
                "width": finalized.width,
                "height": finalized.height,
            }
        )
        return Response(serializer.data)

    @validated_request(
        request_serializer=AttachmentDeleteRequestSerializer,
        responses={204: OpenApiResponse(description="Attachment deleted.")},
        operation_id="assistantAttachmentsDeleteCreate",
        summary="Delete one sandbox image attachment",
        description="Idempotently delete a single staged or finalized sandbox image attachment for one conversation.",
        strict_request_validation=True,
    )
    @action(detail=False, methods=["post"], url_path="delete", required_scopes=["project:write"])
    def delete(self, request: ValidatedRequest, *args: Any, **kwargs: Any) -> Response:
        data = cast(dict[str, Any], request.validated_data)
        conversation_id = data["conversation_id"]
        self._resolve_conversation(request, conversation_id)
        try:
            delete_attachment(
                team_id=self.team.id,
                user_id=cast(User, request.user).id,
                conversation_id=conversation_id,
                attachment_id=str(data["attachment_id"]),
            )
        except AttachmentNotFoundError:
            pass
        return Response(status=204)
