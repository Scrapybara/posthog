from typing import cast

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import UploadedFile
from django.db.models import QuerySet
from django.utils.translation import gettext_lazy as _

from drf_spectacular.utils import extend_schema
from rest_framework import exceptions, serializers, status, viewsets
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response

from posthog.api.routing import TeamAndOrgViewSetMixin
from posthog.models.user import User

from products.posthog_ai.backend.attachments import (
    MAX_ATTACHMENT_BYTES,
    AttachmentStorageUnavailableError,
    AttachmentValidationError,
    create_attachment,
    delete_attachment,
    serialize_attachment,
)
from products.posthog_ai.backend.models.assistant import Conversation, ConversationAttachment


class AttachmentStorageUnavailable(exceptions.APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = _("Image attachment storage is temporarily unavailable.")
    default_code = "attachment_storage_unavailable"


class ConversationAttachmentCreateSerializer(serializers.Serializer):
    conversation_id = serializers.UUIDField(
        required=True,
        help_text="Conversation UUID the pending image attachment belongs to.",
    )
    file = serializers.FileField(
        required=True,
        max_length=255,
        help_text="PNG or JPEG image file. Maximum size is 4 MiB.",
    )


class ConversationAttachmentSerializer(serializers.Serializer):
    id = serializers.UUIDField(help_text="Attachment identifier to include when sending a message.")
    filename = serializers.CharField(help_text="Sanitized display filename.")
    content_type = serializers.ChoiceField(
        choices=["image/png", "image/jpeg"],
        help_text="Server-detected image MIME type.",
    )
    byte_size = serializers.IntegerField(help_text="Validated image size in bytes.")


@extend_schema(tags=["max"])
class ConversationAttachmentViewSet(TeamAndOrgViewSetMixin, viewsets.GenericViewSet):
    scope_object = "conversation"
    queryset = ConversationAttachment.objects.unscoped()
    serializer_class = ConversationAttachmentSerializer
    parser_classes = [MultiPartParser, FormParser]

    def _should_skip_parents_filter(self) -> bool:
        return True

    def safely_get_queryset(self, queryset: QuerySet) -> QuerySet:
        return queryset.filter(
            team_id=self.team.parent_team_id or self.team_id,
            created_by=self.request.user,
            deleted=False,
            attachment_status=ConversationAttachment.AttachmentStatus.PENDING,
        )

    def _get_existing_conversation(self, conversation_id: str) -> Conversation | None:
        try:
            conversation = Conversation.objects.exclude(deleted=True).get(id=conversation_id)
        except (Conversation.DoesNotExist, DjangoValidationError):
            return None
        if conversation.user != self.request.user or conversation.team != self.team:
            raise exceptions.PermissionDenied("Cannot attach images to another user's conversation.")
        return conversation

    @extend_schema(
        request=ConversationAttachmentCreateSerializer,
        responses={201: ConversationAttachmentSerializer},
        description="Upload a pending PNG or JPEG image attachment for a PostHog AI conversation.",
    )
    def create(self, request: Request, *args, **kwargs) -> Response:
        serializer = ConversationAttachmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        uploaded_file = cast(UploadedFile, serializer.validated_data["file"])
        if uploaded_file.size is not None and uploaded_file.size > MAX_ATTACHMENT_BYTES:
            raise serializers.ValidationError({"file": "Image must be 4 MiB or smaller."})

        conversation_id = serializer.validated_data["conversation_id"]
        conversation = self._get_existing_conversation(str(conversation_id))
        if conversation is None:
            conversation = Conversation(id=conversation_id, team=self.team, user=cast(User, request.user))

        try:
            attachment = create_attachment(
                team=self.team,
                user=cast(User, request.user),
                conversation=conversation,
                uploaded_file=uploaded_file,
            )
        except AttachmentValidationError as error:
            raise serializers.ValidationError({"file": str(error)}) from error
        except AttachmentStorageUnavailableError as error:
            raise AttachmentStorageUnavailable() from error

        return Response(
            ConversationAttachmentSerializer(serialize_attachment(attachment)).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(
        responses={204: None},
        description="Delete a pending PostHog AI image attachment and remove its private object-storage file.",
    )
    def destroy(self, request: Request, *args, **kwargs) -> Response:
        attachment = self.get_object()
        try:
            delete_attachment(attachment, deleted_by=cast(User, request.user))
        except AttachmentStorageUnavailableError as error:
            raise AttachmentStorageUnavailable() from error
        return Response(status=status.HTTP_204_NO_CONTENT)
