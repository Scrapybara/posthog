import re
import base64
from collections.abc import Sequence
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import UUID, uuid4

from django.conf import settings
from django.core.files.uploadedfile import UploadedFile

from PIL import Image, ImageOps, UnidentifiedImageError

from posthog.models.user import User
from posthog.storage import object_storage
from posthog.sync import database_sync_to_async

from products.posthog_ai.backend.models import ConversationAttachment

if TYPE_CHECKING:
    from posthog.schema import HumanMessage

MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
MAX_ATTACHMENTS_PER_MESSAGE = 4
MAX_DECODED_PIXELS = 25_000_000
ALLOWED_CONTENT_TYPES = frozenset({"image/png", "image/jpeg"})
_FORMAT_TO_CONTENT_TYPE = {"PNG": "image/png", "JPEG": "image/jpeg"}
_FILENAME_UNSAFE = re.compile(r"[^A-Za-z0-9._ -]+")


class InvalidConversationAttachment(ValueError):
    pass


@dataclass(frozen=True)
class ProcessedConversationAttachment:
    content: bytes
    content_type: str
    file_name: str
    width: int
    height: int

    @property
    def size(self) -> int:
        return len(self.content)


def sanitize_attachment_filename(file_name: str, content_type: str) -> str:
    base_name = Path(file_name.replace("\\", "/")).name
    stem = Path(base_name).stem
    safe_stem = _FILENAME_UNSAFE.sub("_", stem).strip(" ._")[:200] or "image"
    extension = ".png" if content_type == "image/png" else ".jpg"
    return f"{safe_stem}{extension}"


def process_conversation_attachment(upload: UploadedFile) -> ProcessedConversationAttachment:
    claimed_content_type = (upload.content_type or "").lower()
    if claimed_content_type == "image/jpg":
        claimed_content_type = "image/jpeg"
    if claimed_content_type not in ALLOWED_CONTENT_TYPES:
        raise InvalidConversationAttachment("Only PNG and JPEG images are supported.")
    if upload.size > MAX_ATTACHMENT_BYTES:
        raise InvalidConversationAttachment("Images must be 4 MiB or smaller.")

    source = upload.read(MAX_ATTACHMENT_BYTES + 1)
    if len(source) > MAX_ATTACHMENT_BYTES:
        raise InvalidConversationAttachment("Images must be 4 MiB or smaller.")

    try:
        with Image.open(BytesIO(source)) as image:
            detected_content_type = _FORMAT_TO_CONTENT_TYPE.get(image.format or "")
            width, height = image.size
            if detected_content_type is None or detected_content_type != claimed_content_type:
                raise InvalidConversationAttachment("The file contents do not match its PNG or JPEG type.")
            if width <= 0 or height <= 0 or width * height > MAX_DECODED_PIXELS:
                raise InvalidConversationAttachment("The decoded image is too large.")
            image.verify()

        with Image.open(BytesIO(source)) as image:
            image.load()
            image = ImageOps.exif_transpose(image)
            output = BytesIO()
            if detected_content_type == "image/jpeg":
                clean_image = image.convert("RGB")
                clean_image.save(output, format="JPEG", quality=90, optimize=True)
            else:
                clean_image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
                clean_image.save(output, format="PNG", optimize=True)
    except InvalidConversationAttachment:
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as error:
        raise InvalidConversationAttachment("The uploaded file is not a valid PNG or JPEG image.") from error

    content = output.getvalue()
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise InvalidConversationAttachment("The sanitized image exceeds the 4 MiB limit.")

    return ProcessedConversationAttachment(
        content=content,
        content_type=detected_content_type,
        file_name=sanitize_attachment_filename(upload.name, detected_content_type),
        width=width,
        height=height,
    )


def save_conversation_attachment(
    *,
    processed: ProcessedConversationAttachment,
    team_id: int,
    creator: User,
    conversation_id: UUID,
) -> ConversationAttachment:
    if not settings.OBJECT_STORAGE_ENABLED:
        raise InvalidConversationAttachment("Private object storage is required for image attachments.")

    extension = "png" if processed.content_type == "image/png" else "jpg"
    object_path = f"posthog_ai/conversation_attachments/{uuid4().hex}.{extension}"
    object_storage.write(
        object_path,
        processed.content,
        extras={"ContentType": processed.content_type, "CacheControl": "private, max-age=3600"},
    )
    try:
        return ConversationAttachment.objects.create(
            team_id=team_id,
            creator=creator,
            conversation_id=conversation_id,
            file_name=processed.file_name,
            content_type=processed.content_type,
            size=processed.size,
            width=processed.width,
            height=processed.height,
            object_path=object_path,
        )
    except Exception:
        object_storage.delete(object_path)
        raise


def attachment_to_ref(attachment: ConversationAttachment) -> dict[str, str | int]:
    return {
        "id": str(attachment.id),
        "file_name": attachment.file_name,
        "content_type": attachment.content_type,
        "size": attachment.size,
        "width": attachment.width,
        "height": attachment.height,
    }


@database_sync_to_async
def _load_scoped_attachments(
    *,
    attachment_ids: set[UUID],
    team_id: int,
    creator_id: int,
    conversation_id: UUID,
) -> dict[UUID, ConversationAttachment]:
    attachments = ConversationAttachment.objects.for_team(team_id).filter(
        id__in=attachment_ids,
        team_id=team_id,
        creator_id=creator_id,
        conversation_id=conversation_id,
    )
    return {attachment.id: attachment for attachment in attachments}


async def load_attachment_blocks(
    messages: Sequence["HumanMessage"],
    *,
    team_id: int,
    creator_id: int,
    conversation_id: UUID,
) -> dict[int, list[dict[str, Any]]]:
    referenced_ids = {UUID(attachment.id) for message in messages for attachment in (message.attachments or [])}
    if not referenced_ids:
        return {}

    attachments_by_id = await _load_scoped_attachments(
        attachment_ids=referenced_ids,
        team_id=team_id,
        creator_id=creator_id,
        conversation_id=conversation_id,
    )
    if len(attachments_by_id) != len(referenced_ids):
        raise InvalidConversationAttachment("One or more conversation attachments are unavailable.")

    blocks_by_message: dict[int, list[dict[str, Any]]] = {}
    for message in messages:
        blocks: list[dict[str, Any]] = []
        for reference in message.attachments or []:
            attachment = attachments_by_id.get(UUID(reference.id))
            if attachment is None:
                raise InvalidConversationAttachment("Conversation attachment is unavailable.")
            content = await database_sync_to_async(object_storage.read_bytes)(attachment.object_path)
            if content is None:
                raise InvalidConversationAttachment("Conversation attachment content is unavailable.")
            blocks.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": attachment.content_type,
                        "data": base64.b64encode(content).decode("ascii"),
                    },
                }
            )
        if blocks:
            blocks_by_message[id(message)] = blocks
    return blocks_by_message
