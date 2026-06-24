import os
import re
import base64
import hashlib
import warnings
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from io import BytesIO
from uuid import UUID

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile
from django.db import (
    connection as db_connection,
    transaction,
)
from django.db.models import Count, Sum
from django.utils import timezone

from PIL import Image, UnidentifiedImageError

from posthog.models.team.team import Team
from posthog.models.user import User
from posthog.storage import object_storage
from posthog.storage.object_storage import ObjectStorageError

from products.posthog_ai.backend.models.assistant import Conversation, ConversationAttachment

MAX_ATTACHMENTS_PER_MESSAGE = 4
MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
MAX_TOTAL_ATTACHMENT_BYTES = 12 * 1024 * 1024
ABANDONED_PENDING_ATTACHMENT_AGE = timedelta(hours=24)
SUPPORTED_ATTACHMENT_CONTENT_TYPES = ("image/png", "image/jpeg")
OBJECT_STORAGE_PREFIX = "posthog_ai/conversation_attachments"
ATTACHMENT_QUOTA_LOCK_NAMESPACE = "posthog_ai_conversation_attachment_quota"
_FILENAME_STRIP_RE = re.compile(r"[^\w\s\-.,()[\]]+")
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_JPEG_SIGNATURE = b"\xff\xd8\xff"


class AttachmentValidationError(ValueError):
    pass


class AttachmentStorageUnavailableError(RuntimeError):
    pass


class AttachmentNotFoundError(ValueError):
    pass


@dataclass(frozen=True)
class ValidatedAttachmentReference:
    id: str
    conversation_id: str
    filename: str
    content_type: str
    byte_size: int

    def as_message_ref(self) -> dict[str, str | int]:
        return {
            "id": self.id,
            "conversation_id": self.conversation_id,
            "filename": self.filename,
            "content_type": self.content_type,
            "byte_size": self.byte_size,
        }


@dataclass(frozen=True)
class ResolvedAttachment:
    id: str
    filename: str
    content_type: str
    byte_size: int
    data: bytes

    def as_anthropic_block(self) -> dict[str, object]:
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": self.content_type,
                "data": base64.b64encode(self.data).decode("ascii"),
            },
        }

    def as_openai_block(self) -> dict[str, object]:
        encoded = base64.b64encode(self.data).decode("ascii")
        return {"type": "image_url", "image_url": {"url": f"data:{self.content_type};base64,{encoded}"}}


def sanitize_filename(filename: str | None) -> str:
    name = (filename or "screenshot").replace("\\", "/")
    name = os.path.basename(name).replace("\x00", "").strip()
    name = _FILENAME_STRIP_RE.sub("", name)
    return name[:255] if name else "screenshot"


def _canonical_team_id(team: Team) -> int:
    return team.parent_team_id or team.id


def _object_key(team: Team, conversation_id: UUID, attachment_id: UUID, content_type: str) -> str:
    extension = "png" if content_type == "image/png" else "jpg"
    return f"{OBJECT_STORAGE_PREFIX}/team_{_canonical_team_id(team)}/{conversation_id}/{attachment_id}.{extension}"


def _acquire_attachment_quota_lock(*, team_id: int, user_id: int, conversation_id: UUID) -> None:
    lock_key = f"{ATTACHMENT_QUOTA_LOCK_NAMESPACE}:{team_id}:{user_id}:{conversation_id}"
    lock_id = int.from_bytes(hashlib.blake2b(lock_key.encode("utf-8"), digest_size=8).digest(), "big")
    with db_connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock_id & 0x7FFFFFFFFFFFFFFF])


def _detect_image_content_type(data: bytes) -> str:
    if data.startswith(_PNG_SIGNATURE):
        expected_format = "PNG"
    elif data.startswith(_JPEG_SIGNATURE):
        expected_format = "JPEG"
    else:
        raise AttachmentValidationError("Only PNG and JPEG images are supported.")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                image.verify()
                detected_format = image.format
            with Image.open(BytesIO(data)) as image:
                image.load()
                loaded_format = image.format
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise AttachmentValidationError("Image file is invalid or corrupt.") from error

    if detected_format != expected_format or loaded_format != expected_format:
        raise AttachmentValidationError("Image file content does not match its signature.")
    if expected_format == "PNG":
        return "image/png"
    return "image/jpeg"


def _read_upload(uploaded_file: UploadedFile) -> bytes:
    if uploaded_file.size is not None and uploaded_file.size > MAX_ATTACHMENT_BYTES:
        raise AttachmentValidationError("Image must be 4 MiB or smaller.")
    data = uploaded_file.read()
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise AttachmentValidationError("Image must be 4 MiB or smaller.")
    if not data:
        raise AttachmentValidationError("Image file is empty.")
    return data


def create_attachment(
    *,
    team: Team,
    user: User,
    conversation: Conversation,
    uploaded_file: UploadedFile,
) -> ConversationAttachment:
    if not settings.OBJECT_STORAGE_ENABLED:
        raise AttachmentStorageUnavailableError("Object storage is not available.")

    data = _read_upload(uploaded_file)
    content_type = _detect_image_content_type(data)
    attachment = ConversationAttachment(
        team=team,
        conversation_id=conversation.id,
        created_by=user,
        original_filename=sanitize_filename(uploaded_file.name),
        content_type=content_type,
        byte_size=len(data),
        object_key="",
    )
    attachment.object_key = _object_key(team, conversation.id, attachment.id, content_type)

    object_written = False
    try:
        with transaction.atomic():
            _acquire_attachment_quota_lock(team_id=team.id, user_id=user.id, conversation_id=conversation.id)
            pending_attachment_totals = (
                ConversationAttachment.objects.for_team(team.id)
                .filter(
                    conversation_id=conversation.id,
                    created_by=user,
                    deleted=False,
                    attachment_status=ConversationAttachment.AttachmentStatus.PENDING,
                )
                .aggregate(count=Count("id"), byte_size=Sum("byte_size"))
            )
            pending_count = pending_attachment_totals["count"] or 0
            pending_byte_size = pending_attachment_totals["byte_size"] or 0
            if pending_count >= MAX_ATTACHMENTS_PER_MESSAGE:
                raise AttachmentValidationError("You can attach up to 4 images.")
            if pending_byte_size + len(data) > MAX_TOTAL_ATTACHMENT_BYTES:
                raise AttachmentValidationError("Images must be 12 MiB or smaller in total.")

            object_storage.write(attachment.object_key, data, extras={"ContentType": content_type})
            object_written = True
            attachment.save()
    except ObjectStorageError as error:
        raise AttachmentStorageUnavailableError("Object storage write failed.") from error
    except Exception:
        if object_written:
            object_storage.delete(attachment.object_key)
        raise
    return attachment


def serialize_attachment(attachment: ConversationAttachment) -> dict[str, str | int]:
    return {
        "id": str(attachment.id),
        "filename": attachment.original_filename,
        "content_type": attachment.content_type,
        "byte_size": attachment.byte_size,
    }


def delete_attachment(attachment: ConversationAttachment, *, deleted_by: User | None = None) -> None:
    try:
        object_storage.delete(attachment.object_key)
    except ObjectStorageError as error:
        raise AttachmentStorageUnavailableError("Object storage delete failed.") from error

    attachment.deleted = True
    attachment.deleted_at = timezone.now()
    attachment.deleted_by = deleted_by
    attachment.save(update_fields=["deleted", "deleted_at", "deleted_by", "updated_at"])


def delete_conversation_attachments(conversation: Conversation, *, deleted_by: User | None = None) -> None:
    attachments = list(
        ConversationAttachment.objects.unscoped()
        .filter(conversation_id=conversation.id, deleted=False)
        .only("id", "object_key")
    )
    if not attachments:
        return

    try:
        failed_keys = object_storage.delete_objects([attachment.object_key for attachment in attachments])
    except ObjectStorageError as error:
        raise AttachmentStorageUnavailableError("Object storage delete failed.") from error
    deleted_ids = [attachment.id for attachment in attachments if attachment.object_key not in failed_keys]
    if deleted_ids:
        ConversationAttachment.objects.unscoped().filter(id__in=deleted_ids).update(
            deleted=True,
            deleted_at=timezone.now(),
            deleted_by=deleted_by,
        )
    if failed_keys:
        raise AttachmentStorageUnavailableError("Object storage delete failed.")


def cleanup_abandoned_pending_attachments(now: datetime | None = None) -> int:
    cutoff = (now or timezone.now()) - ABANDONED_PENDING_ATTACHMENT_AGE
    attachments = list(
        ConversationAttachment.objects.unscoped()
        .filter(
            attachment_status=ConversationAttachment.AttachmentStatus.PENDING,
            deleted=False,
            created_at__lt=cutoff,
        )
        .only("id", "object_key")
    )
    if not attachments:
        return 0

    failed_keys = object_storage.delete_objects([attachment.object_key for attachment in attachments])
    deleted_ids = [attachment.id for attachment in attachments if attachment.object_key not in failed_keys]
    if deleted_ids:
        ConversationAttachment.objects.unscoped().filter(id__in=deleted_ids).update(
            deleted=True,
            deleted_at=timezone.now(),
        )
    return len(deleted_ids)


def validate_attachment_references(
    *,
    team: Team,
    user: User,
    conversation: Conversation,
    attachment_ids: Iterable[UUID],
) -> list[ValidatedAttachmentReference]:
    unique_attachment_ids = list(dict.fromkeys(attachment_ids))
    if len(unique_attachment_ids) > MAX_ATTACHMENTS_PER_MESSAGE:
        raise AttachmentValidationError("You can attach up to 4 images.")
    if not unique_attachment_ids:
        return []

    attachments_by_id = {
        attachment.id: attachment
        for attachment in ConversationAttachment.objects.for_team(team.id)
        .filter(id__in=unique_attachment_ids, deleted=False)
        .only(
            "id",
            "conversation_id",
            "created_by_id",
            "original_filename",
            "content_type",
            "byte_size",
            "attachment_status",
        )
    }
    if len(attachments_by_id) != len(unique_attachment_ids):
        raise AttachmentNotFoundError("One or more attachments were not found.")

    references: list[ValidatedAttachmentReference] = []
    total_size = 0
    for attachment_id in unique_attachment_ids:
        attachment = attachments_by_id[attachment_id]
        if attachment.conversation_id != conversation.id or attachment.created_by_id != user.id:
            raise AttachmentNotFoundError("One or more attachments were not found.")
        total_size += attachment.byte_size
        references.append(
            ValidatedAttachmentReference(
                id=str(attachment.id),
                conversation_id=str(conversation.id),
                filename=attachment.original_filename,
                content_type=attachment.content_type,
                byte_size=attachment.byte_size,
            )
        )

    if total_size > MAX_TOTAL_ATTACHMENT_BYTES:
        raise AttachmentValidationError("Images must be 12 MiB or smaller in total.")

    return references


def mark_attachment_references_attached(*, team: Team, references: Iterable[ValidatedAttachmentReference]) -> None:
    attachment_ids = [UUID(reference.id) for reference in references]
    if not attachment_ids:
        return
    ConversationAttachment.objects.for_team(team.id).filter(id__in=attachment_ids, deleted=False).update(
        attachment_status=ConversationAttachment.AttachmentStatus.ATTACHED,
        attached_at=timezone.now(),
    )


def resolve_message_attachments(
    *,
    team: Team,
    attachment_refs: Iterable[object],
) -> list[ResolvedAttachment]:
    ordered_refs: list[tuple[UUID, str]] = []
    for attachment_ref in attachment_refs:
        if isinstance(attachment_ref, dict):
            raw_id = attachment_ref.get("id")
            raw_conversation_id = attachment_ref.get("conversation_id")
        else:
            raw_id = getattr(attachment_ref, "id", None)
            raw_conversation_id = getattr(attachment_ref, "conversation_id", None)
        if not isinstance(raw_id, str) or not isinstance(raw_conversation_id, str):
            continue
        try:
            ordered_refs.append((UUID(raw_id), raw_conversation_id))
        except ValueError:
            continue

    if not ordered_refs:
        return []

    attachments_by_id = {
        attachment.id: attachment
        for attachment in ConversationAttachment.objects.for_team(team.id).filter(
            id__in=[attachment_id for attachment_id, _conversation_id in ordered_refs], deleted=False
        )
    }
    resolved: list[ResolvedAttachment] = []
    for attachment_id, conversation_id in ordered_refs:
        attachment = attachments_by_id.get(attachment_id)
        if attachment is None or str(attachment.conversation_id) != conversation_id:
            continue
        data = object_storage.read_bytes(attachment.object_key)
        if data is None:
            continue
        resolved.append(
            ResolvedAttachment(
                id=str(attachment.id),
                filename=attachment.original_filename,
                content_type=attachment.content_type,
                byte_size=attachment.byte_size,
                data=data,
            )
        )
    return resolved
