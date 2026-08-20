from __future__ import annotations

import os
import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import timedelta
from io import BytesIO
from typing import Any
from uuid import UUID, uuid4

from django.utils import timezone

import structlog
from PIL import Image, ImageOps, UnidentifiedImageError

from posthog.dataclasses import frozen
from posthog.storage import object_storage

from products.tasks.backend.facade import api as tasks_facade
from products.tasks.backend.redis import get_tasks_cache

MAX_ATTACHMENT_COUNT = 4
MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
MAX_MESSAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_USER_STAGED_ATTACHMENT_COUNT = 20
MAX_USER_STAGED_ATTACHMENT_BYTES = 50 * 1024 * 1024
MAX_DECODED_PIXELS = 20_000_000
ATTACHMENT_CACHE_TTL_SECONDS = 24 * 60 * 60
ATTACHMENT_UPLOAD_EXPIRATION_SECONDS = 15 * 60
ATTACHMENT_STAGING_TTL_DAYS = "1"
SUPPORTED_CONTENT_TYPES = ("image/png", "image/jpeg")
_FORMAT_BY_CONTENT_TYPE = {"image/png": "PNG", "image/jpeg": "JPEG"}
_EXTENSION_BY_CONTENT_TYPE = {"image/png": "png", "image/jpeg": "jpg"}
_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_JPEG_SIGNATURE = b"\xff\xd8\xff"
_CACHE_PREFIX = "posthog_ai:assistant_attachment"
_LOCK_TTL_SECONDS = 3 * 60
_LOCK_WAIT_SECONDS = 15

logger = structlog.get_logger(__name__)


class AttachmentError(Exception):
    pass


class AttachmentValidationError(AttachmentError):
    pass


class AttachmentNotFoundError(AttachmentError):
    pass


class AttachmentStorageError(AttachmentError):
    pass


@frozen
class PreparedAttachment:
    id: str
    file_name: str
    content_type: str
    size: int
    upload_url: str
    upload_fields: dict[str, str]


@frozen
class FinalizedAttachment:
    id: str
    file_name: str
    content_type: str
    size: int
    width: int
    height: int


@frozen
class AttachmentPromotion:
    attachment_ids: list[str]
    newly_attached_ids: list[str]
    task_id: str
    run_id: str
    records: list[dict[str, Any]]


@frozen
class _PreparedAttachmentSpec:
    id: str
    file_name: str
    content_type: str
    size: int
    raw_storage_path: str
    upload_url: str
    upload_fields: dict[str, str]


def _cache() -> Any:
    return get_tasks_cache()


def _record_key(attachment_id: str) -> str:
    return f"{_CACHE_PREFIX}:record:{attachment_id}"


def _conversation_index_key(team_id: int, user_id: int, conversation_id: UUID | str) -> str:
    return f"{_CACHE_PREFIX}:conversation:{team_id}:{user_id}:{conversation_id}"


def _user_index_key(team_id: int, user_id: int) -> str:
    return f"{_CACHE_PREFIX}:user:{team_id}:{user_id}"


def _lock_key(name: str) -> str:
    return f"{_CACHE_PREFIX}:lock:{name}"


def _user_lock_key(team_id: int, user_id: int) -> str:
    return _lock_key(f"user:{team_id}:{user_id}")


def _attachment_lock_key(attachment_id: str) -> str:
    return _lock_key(f"attachment:{attachment_id}")


@contextmanager
def _cache_locks(
    keys: Sequence[str], *, ttl: int = _LOCK_TTL_SECONDS, wait: int = _LOCK_WAIT_SECONDS
) -> Iterator[None]:
    cache = _cache()
    ordered_keys = list(dict.fromkeys(sorted(keys)))
    acquired: list[tuple[str, str]] = []
    deadline = time.monotonic() + wait

    try:
        for key in ordered_keys:
            token = str(uuid4())
            while True:
                if cache.add(key, token, timeout=ttl):
                    acquired.append((key, token))
                    break
                if time.monotonic() >= deadline:
                    raise AttachmentStorageError("Could not acquire the attachment lock. Try again.")
                time.sleep(0.05)
        yield
    finally:
        for key, token in reversed(acquired):
            try:
                if cache.get(key) == token:
                    cache.delete(key)
            except Exception:
                logger.warning("assistant_attachment_lock_release_failed", lock_key=key)


def _safe_name(name: str, content_type: str) -> str:
    base_name = os.path.basename(name).strip() or "image"
    stem = os.path.splitext(base_name)[0].strip() or "image"
    extension = _EXTENSION_BY_CONTENT_TYPE[content_type]
    return f"{stem[:240]}.{extension}"


def _raw_storage_path(team_id: int, user_id: int, conversation_id: UUID, attachment_id: str) -> str:
    return (
        f"posthog_ai/assistant_attachments/team_{team_id}/user_{user_id}/"
        f"conversation_{conversation_id}/uploads/{attachment_id}"
    )


def _normalized_storage_path(
    team_id: int, user_id: int, conversation_id: UUID, attachment_id: str, content_type: str
) -> str:
    extension = _EXTENSION_BY_CONTENT_TYPE[content_type]
    return (
        f"posthog_ai/assistant_attachments/team_{team_id}/user_{user_id}/"
        f"conversation_{conversation_id}/normalized/{attachment_id}.{extension}"
    )


def _get_index(key: str) -> list[str]:
    value = _cache().get(key)
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _get_record(attachment_id: str) -> dict[str, Any] | None:
    value = _cache().get(_record_key(attachment_id))
    return value if isinstance(value, dict) else None


def _write_records_and_indexes(
    *,
    records: Sequence[dict[str, Any]],
    team_id: int,
    user_id: int,
    conversation_id: UUID,
    conversation_ids: list[str],
    user_ids: list[str],
) -> None:
    conversation_key = _conversation_index_key(team_id, user_id, conversation_id)
    user_key = _user_index_key(team_id, user_id)
    values = {
        conversation_key: conversation_ids,
        user_key: user_ids,
        **{_record_key(str(record["id"])): record for record in records},
    }
    _cache().set_many(values, timeout=ATTACHMENT_CACHE_TTL_SECONDS)


def _active_records(index_ids: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    active_ids: list[str] = []
    for attachment_id in index_ids:
        record = _get_record(attachment_id)
        if record is None or record.get("status") not in {"prepared", "finalized"}:
            continue
        records.append(record)
        active_ids.append(attachment_id)
    return records, active_ids


def _quota_records(index_ids: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    active_ids: list[str] = []
    now = timezone.now().timestamp()
    for attachment_id in index_ids:
        record = _get_record(attachment_id)
        if record is None:
            continue
        status = record.get("status")
        if status not in {"prepared", "finalized"} and not (
            status == "deleted" and float(record.get("upload_expires_at", 0)) > now
        ):
            continue
        records.append(record)
        active_ids.append(attachment_id)
    return records, active_ids


def _record_quota_size(record: dict[str, Any]) -> int:
    declared_size = record.get("declared_size")
    normalized_size = record.get("normalized_size")
    sizes = [size for size in (declared_size, normalized_size) if isinstance(size, int)]
    return max(sizes, default=0)


def _as_finalized_record(record: dict[str, Any]) -> dict[str, Any]:
    restored = {key: value for key, value in record.items() if key not in {"promoted_task_id", "promoted_run_id"}}
    restored["status"] = "finalized"
    return restored


def prepare_attachments(
    *,
    team_id: int,
    user_id: int,
    conversation_id: UUID,
    attachments: Sequence[dict[str, Any]],
) -> list[PreparedAttachment]:
    if not attachments or len(attachments) > MAX_ATTACHMENT_COUNT:
        raise AttachmentValidationError("Attach between 1 and 4 images.")

    requested_bytes = sum(int(attachment["size"]) for attachment in attachments)
    if requested_bytes > MAX_MESSAGE_ATTACHMENT_BYTES:
        raise AttachmentValidationError("Images must be 10 MiB or smaller in total.")

    tagging = f"ttl_days={ATTACHMENT_STAGING_TTL_DAYS}&team_id={team_id}"
    upload_expires_at = (timezone.now() + timedelta(seconds=ATTACHMENT_UPLOAD_EXPIRATION_SECONDS)).timestamp()
    prepared_specs: list[_PreparedAttachmentSpec] = []
    for attachment in attachments:
        content_type = str(attachment["content_type"])
        if content_type not in SUPPORTED_CONTENT_TYPES:
            raise AttachmentValidationError("Only PNG and JPEG images are supported.")
        attachment_id = str(uuid4())
        raw_path = _raw_storage_path(team_id, user_id, conversation_id, attachment_id)
        presigned_post = object_storage.get_presigned_post(
            raw_path,
            conditions=[
                ["content-length-range", int(attachment["size"]), int(attachment["size"])],
                {"Content-Type": content_type},
                {"x-amz-tagging": tagging},
            ],
            expiration=ATTACHMENT_UPLOAD_EXPIRATION_SECONDS,
        )
        if not presigned_post:
            raise AttachmentStorageError("Could not prepare the image upload. Try again.")
        fields = {str(key): str(value) for key, value in dict(presigned_post.get("fields") or {}).items()}
        fields["Content-Type"] = content_type
        fields["x-amz-tagging"] = tagging
        prepared_specs.append(
            _PreparedAttachmentSpec(
                id=attachment_id,
                file_name=_safe_name(str(attachment["file_name"]), content_type),
                content_type=content_type,
                size=int(attachment["size"]),
                raw_storage_path=raw_path,
                upload_url=str(presigned_post["url"]),
                upload_fields=fields,
            )
        )

    with _cache_locks([_user_lock_key(team_id, user_id)]):
        user_key = _user_index_key(team_id, user_id)
        conversation_key = _conversation_index_key(team_id, user_id, conversation_id)
        user_records, active_user_ids = _quota_records(_get_index(user_key))
        conversation_records, active_conversation_ids = _active_records(_get_index(conversation_key))

        if len(active_conversation_ids) + len(prepared_specs) > MAX_ATTACHMENT_COUNT:
            raise AttachmentValidationError("You can attach up to 4 images to one message.")
        if (
            sum(_record_quota_size(record) for record in conversation_records) + requested_bytes
            > MAX_MESSAGE_ATTACHMENT_BYTES
        ):
            raise AttachmentValidationError("Images must be 10 MiB or smaller in total.")
        if len(active_user_ids) + len(prepared_specs) > MAX_USER_STAGED_ATTACHMENT_COUNT:
            raise AttachmentValidationError("You can have up to 20 images waiting to be sent.")
        if (
            sum(_record_quota_size(record) for record in user_records) + requested_bytes
            > MAX_USER_STAGED_ATTACHMENT_BYTES
        ):
            raise AttachmentValidationError("Images waiting to be sent must be 50 MiB or smaller in total.")

        records = [
            {
                "id": spec.id,
                "team_id": team_id,
                "user_id": user_id,
                "conversation_id": str(conversation_id),
                "file_name": spec.file_name,
                "content_type": spec.content_type,
                "declared_size": spec.size,
                "raw_storage_path": spec.raw_storage_path,
                "status": "prepared",
                "created_at": timezone.now().isoformat(),
                "upload_expires_at": upload_expires_at,
            }
            for spec in prepared_specs
        ]
        _write_records_and_indexes(
            records=records,
            team_id=team_id,
            user_id=user_id,
            conversation_id=conversation_id,
            conversation_ids=[*active_conversation_ids, *(str(record["id"]) for record in records)],
            user_ids=[*active_user_ids, *(str(record["id"]) for record in records)],
        )

    return [
        PreparedAttachment(
            id=spec.id,
            file_name=spec.file_name,
            content_type=spec.content_type,
            size=spec.size,
            upload_url=spec.upload_url,
            upload_fields=spec.upload_fields,
        )
        for spec in prepared_specs
    ]


def _validate_and_normalize_image(content: bytes, content_type: str) -> tuple[bytes, int, int]:
    if content_type == "image/png" and not content.startswith(_PNG_SIGNATURE):
        raise AttachmentValidationError("The image contents do not match the selected PNG type.")
    if content_type == "image/jpeg" and not content.startswith(_JPEG_SIGNATURE):
        raise AttachmentValidationError("The image contents do not match the selected JPEG type.")

    try:
        with Image.open(BytesIO(content)) as image:
            if image.format != _FORMAT_BY_CONTENT_TYPE[content_type]:
                raise AttachmentValidationError("The image contents do not match the selected file type.")
            if bool(getattr(image, "is_animated", False)) or int(getattr(image, "n_frames", 1)) != 1:
                raise AttachmentValidationError("Animated images are not supported.")
            width, height = image.size
            if width <= 0 or height <= 0 or width * height >= MAX_DECODED_PIXELS:
                raise AttachmentValidationError("The image must contain fewer than 20 million pixels.")
            image.verify()

        with Image.open(BytesIO(content)) as image:
            image.load()
            transposed = ImageOps.exif_transpose(image)
            width, height = transposed.size
            if width * height >= MAX_DECODED_PIXELS:
                raise AttachmentValidationError("The image must contain fewer than 20 million pixels.")
            output = BytesIO()
            if content_type == "image/jpeg":
                clean = transposed.convert("RGB")
                clean.save(output, format="JPEG", quality=90, optimize=True)
            else:
                has_transparency = "A" in transposed.getbands() or "transparency" in transposed.info
                clean = transposed.convert("RGBA" if has_transparency else "RGB")
                clean.save(output, format="PNG", optimize=True)
    except AttachmentValidationError:
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as error:
        raise AttachmentValidationError("The uploaded file is not a valid PNG or JPEG image.") from error

    normalized = output.getvalue()
    if len(normalized) > MAX_ATTACHMENT_BYTES:
        raise AttachmentValidationError("The normalized image is larger than 4 MiB.")
    return normalized, width, height


def _scoped_records(
    *, team_id: int, user_id: int, conversation_id: UUID, attachment_ids: Sequence[str]
) -> list[dict[str, Any]]:
    if (
        not attachment_ids
        or len(attachment_ids) > MAX_ATTACHMENT_COUNT
        or len(set(attachment_ids)) != len(attachment_ids)
    ):
        raise AttachmentValidationError("Provide between 1 and 4 unique attachment IDs.")
    records: list[dict[str, Any]] = []
    for attachment_id in attachment_ids:
        record = _get_record(attachment_id)
        if (
            record is None
            or record.get("team_id") != team_id
            or record.get("user_id") != user_id
            or record.get("conversation_id") != str(conversation_id)
        ):
            raise AttachmentNotFoundError("One or more image attachments were not found.")
        records.append(record)
    return records


def _delete_objects(paths: Sequence[str]) -> None:
    for path in paths:
        try:
            object_storage.delete(path)
        except Exception:
            pass


def _remove_records_locked(
    *, team_id: int, user_id: int, conversation_id: UUID, records: Sequence[dict[str, Any]]
) -> None:
    removed_ids = {str(record["id"]) for record in records}
    conversation_key = _conversation_index_key(team_id, user_id, conversation_id)
    user_key = _user_index_key(team_id, user_id)
    conversation_ids = [item for item in _get_index(conversation_key) if item not in removed_ids]
    user_ids = [item for item in _get_index(user_key) if item not in removed_ids]
    now = timezone.now().timestamp()
    tombstones = [
        {**record, "status": "deleted"} for record in records if float(record.get("upload_expires_at", 0)) > now
    ]
    user_ids.extend(str(record["id"]) for record in tombstones if str(record["id"]) not in user_ids)
    _write_records_and_indexes(
        records=tombstones,
        team_id=team_id,
        user_id=user_id,
        conversation_id=conversation_id,
        conversation_ids=conversation_ids,
        user_ids=user_ids,
    )
    tombstone_ids = {str(record["id"]) for record in tombstones}
    expired_ids = removed_ids - tombstone_ids
    if expired_ids:
        _cache().delete_many([_record_key(attachment_id) for attachment_id in expired_ids])


def finalize_attachments(
    *, team_id: int, user_id: int, conversation_id: UUID, attachment_id: str
) -> FinalizedAttachment:
    lock_keys = [_user_lock_key(team_id, user_id), _attachment_lock_key(attachment_id)]
    with _cache_locks(lock_keys):
        record = _scoped_records(
            team_id=team_id,
            user_id=user_id,
            conversation_id=conversation_id,
            attachment_ids=[attachment_id],
        )[0]
        if record.get("status") == "finalized":
            return FinalizedAttachment(
                id=str(record["id"]),
                file_name=str(record["file_name"]),
                content_type=str(record["content_type"]),
                size=int(record["normalized_size"]),
                width=int(record["width"]),
                height=int(record["height"]),
            )
        if record.get("status") != "prepared":
            raise AttachmentValidationError("This image attachment cannot be finalized.")
        if float(record.get("upload_expires_at", 0)) <= timezone.now().timestamp():
            _remove_records_locked(team_id=team_id, user_id=user_id, conversation_id=conversation_id, records=[record])
            raise AttachmentValidationError("This image upload has expired. Upload it again.")

        normalized_paths: list[str] = []
        try:
            raw_path = str(record["raw_storage_path"])
            stored_object = object_storage.read_object(raw_path, missing_ok=True)
            if stored_object is None:
                raise AttachmentValidationError("An uploaded image could not be found. Upload it again.")
            content, stored_content_type = stored_object
            content_length = len(content)
            if content_length != record["declared_size"]:
                raise AttachmentValidationError("The uploaded image size does not match the signed upload size.")
            if stored_content_type != record["content_type"]:
                raise AttachmentValidationError("The uploaded image type does not match the signed upload type.")
            normalized, width, height = _validate_and_normalize_image(content, str(record["content_type"]))
            normalized_path = _normalized_storage_path(
                team_id, user_id, conversation_id, str(record["id"]), str(record["content_type"])
            )
            object_storage.write(normalized_path, normalized, extras={"ContentType": str(record["content_type"])})
            normalized_paths.append(normalized_path)
            object_storage.tag(
                normalized_path,
                {"ttl_days": ATTACHMENT_STAGING_TTL_DAYS, "team_id": str(team_id)},
            )
        except AttachmentValidationError:
            _delete_objects([str(record["raw_storage_path"]), *normalized_paths])
            _remove_records_locked(team_id=team_id, user_id=user_id, conversation_id=conversation_id, records=[record])
            raise
        except Exception as error:
            _delete_objects(normalized_paths)
            raise AttachmentStorageError("Could not process the image. Try uploading it again.") from error

        current_record = _scoped_records(
            team_id=team_id,
            user_id=user_id,
            conversation_id=conversation_id,
            attachment_ids=[attachment_id],
        )[0]
        if current_record.get("status") == "finalized":
            return FinalizedAttachment(
                id=str(current_record["id"]),
                file_name=str(current_record["file_name"]),
                content_type=str(current_record["content_type"]),
                size=int(current_record["normalized_size"]),
                width=int(current_record["width"]),
                height=int(current_record["height"]),
            )
        if current_record.get("status") != "prepared":
            _delete_objects(normalized_paths)
            raise AttachmentValidationError("This image attachment changed while finalizing.")

        user_records, active_user_ids = _quota_records(_get_index(_user_index_key(team_id, user_id)))
        conversation_records, active_conversation_ids = _active_records(
            _get_index(_conversation_index_key(team_id, user_id, conversation_id))
        )
        normalized_size = len(normalized)
        other_user_bytes = sum(_record_quota_size(r) for r in user_records if str(r["id"]) != attachment_id)
        other_conversation_bytes = sum(
            _record_quota_size(r) for r in conversation_records if str(r["id"]) != attachment_id
        )
        if other_conversation_bytes + normalized_size > MAX_MESSAGE_ATTACHMENT_BYTES:
            _delete_objects(normalized_paths)
            raise AttachmentValidationError("Images must be 10 MiB or smaller in total after processing.")
        if other_user_bytes + normalized_size > MAX_USER_STAGED_ATTACHMENT_BYTES:
            _delete_objects(normalized_paths)
            raise AttachmentValidationError(
                "Images waiting to be sent must be 50 MiB or smaller in total after processing."
            )

        updated_record = {
            **current_record,
            "status": "finalized",
            "normalized_storage_path": normalized_path,
            "normalized_size": normalized_size,
            "width": width,
            "height": height,
        }
        _write_records_and_indexes(
            records=[updated_record],
            team_id=team_id,
            user_id=user_id,
            conversation_id=conversation_id,
            conversation_ids=active_conversation_ids,
            user_ids=active_user_ids,
        )

    _delete_objects([str(record["raw_storage_path"])])
    return FinalizedAttachment(
        id=str(updated_record["id"]),
        file_name=str(updated_record["file_name"]),
        content_type=str(updated_record["content_type"]),
        size=int(updated_record["normalized_size"]),
        width=int(updated_record["width"]),
        height=int(updated_record["height"]),
    )


def delete_attachment(*, team_id: int, user_id: int, conversation_id: UUID, attachment_id: str) -> None:
    lock_keys = [_user_lock_key(team_id, user_id), _attachment_lock_key(attachment_id)]
    with _cache_locks(lock_keys):
        records = _scoped_records(
            team_id=team_id, user_id=user_id, conversation_id=conversation_id, attachment_ids=[attachment_id]
        )
        record = records[0]
        paths = [str(record["raw_storage_path"])]
        if record.get("normalized_storage_path"):
            paths.append(str(record["normalized_storage_path"]))
        _delete_objects(paths)
        _remove_records_locked(team_id=team_id, user_id=user_id, conversation_id=conversation_id, records=records)


def validate_new_run_attachments(
    *, team_id: int, user_id: int, conversation_id: UUID, attachment_ids: Sequence[str]
) -> None:
    if not attachment_ids:
        return

    lock_keys = [
        _user_lock_key(team_id, user_id),
        *(_attachment_lock_key(attachment_id) for attachment_id in attachment_ids),
    ]
    with _cache_locks(lock_keys):
        records = _scoped_records(
            team_id=team_id,
            user_id=user_id,
            conversation_id=conversation_id,
            attachment_ids=attachment_ids,
        )
        if any(record.get("status") == "promoted" for record in records):
            raise AttachmentValidationError("An image attachment has already been sent in another message.")
        if any(
            record.get("status") not in {"finalized", "promotion_pending", "rollback_pending"} for record in records
        ):
            raise AttachmentValidationError("Finalize every image before sending the message.")


def promote_attachments(
    *,
    team_id: int,
    user_id: int,
    conversation_id: UUID,
    task_id: str,
    run_id: str,
    attachment_ids: Sequence[str],
) -> AttachmentPromotion | None:
    if not attachment_ids:
        return None

    lock_keys = [
        _user_lock_key(team_id, user_id),
        *(_attachment_lock_key(attachment_id) for attachment_id in attachment_ids),
    ]
    with _cache_locks(lock_keys):
        records = _scoped_records(
            team_id=team_id, user_id=user_id, conversation_id=conversation_id, attachment_ids=attachment_ids
        )
        pending_records = [
            record for record in records if record.get("status") in {"promotion_pending", "rollback_pending"}
        ]
        if pending_records:
            pending_by_run: dict[tuple[str, str], list[str]] = {}
            for record in pending_records:
                pending_key = (str(record["promoted_task_id"]), str(record["promoted_run_id"]))
                pending_by_run.setdefault(pending_key, []).append(str(record["id"]))
            for (pending_task_id, pending_run_id), pending_ids in pending_by_run.items():
                tasks_facade.rollback_posthog_ai_attachments(
                    task_id=pending_task_id,
                    run_id=pending_run_id,
                    team_id=team_id,
                    attachment_ids=pending_ids,
                )
            pending_id_set = {str(record["id"]) for record in pending_records}
            records = [
                _as_finalized_record(record) if str(record["id"]) in pending_id_set else record for record in records
            ]
            conversation_ids = _get_index(_conversation_index_key(team_id, user_id, conversation_id))
            user_ids = _get_index(_user_index_key(team_id, user_id))
            for pending_record in pending_records:
                pending_id = str(pending_record["id"])
                if pending_id not in conversation_ids:
                    conversation_ids.append(pending_id)
                if pending_id not in user_ids:
                    user_ids.append(pending_id)
            _write_records_and_indexes(
                records=records,
                team_id=team_id,
                user_id=user_id,
                conversation_id=conversation_id,
                conversation_ids=conversation_ids,
                user_ids=user_ids,
            )
        if any(record.get("status") not in {"finalized", "promoted"} for record in records):
            raise AttachmentValidationError("Finalize every image before sending the message.")
        for record in records:
            if record.get("status") == "promoted" and record.get("promoted_run_id") != run_id:
                raise AttachmentValidationError("An image attachment has already been sent in another message.")

        finalized_records = [record for record in records if record.get("status") == "finalized"]
        if not finalized_records:
            return AttachmentPromotion(
                attachment_ids=[str(record["id"]) for record in records],
                newly_attached_ids=[],
                task_id=task_id,
                run_id=run_id,
                records=records,
            )

        finalized_ids = {str(record["id"]) for record in finalized_records}
        checkpoint_records = [
            {
                **record,
                "status": "promotion_pending",
                "promoted_task_id": task_id,
                "promoted_run_id": run_id,
            }
            for record in finalized_records
        ]
        conversation_ids = [
            item
            for item in _get_index(_conversation_index_key(team_id, user_id, conversation_id))
            if item not in finalized_ids
        ]
        user_ids = [item for item in _get_index(_user_index_key(team_id, user_id)) if item not in finalized_ids]
        _write_records_and_indexes(
            records=checkpoint_records,
            team_id=team_id,
            user_id=user_id,
            conversation_id=conversation_id,
            conversation_ids=conversation_ids,
            user_ids=user_ids,
        )

        try:
            result = tasks_facade.promote_posthog_ai_attachments(
                task_id=task_id,
                run_id=run_id,
                team_id=team_id,
                user_id=user_id,
                conversation_id=str(conversation_id),
                attachments=records,
            )
            if result is None:
                raise AttachmentNotFoundError("The sandbox run for these image attachments was not found.")
        except Exception:
            try:
                restored_conversation_ids = _get_index(_conversation_index_key(team_id, user_id, conversation_id))
                restored_user_ids = _get_index(_user_index_key(team_id, user_id))
                for finalized_id in finalized_ids:
                    if finalized_id not in restored_conversation_ids:
                        restored_conversation_ids.append(finalized_id)
                    if finalized_id not in restored_user_ids:
                        restored_user_ids.append(finalized_id)
                _write_records_and_indexes(
                    records=finalized_records,
                    team_id=team_id,
                    user_id=user_id,
                    conversation_id=conversation_id,
                    conversation_ids=restored_conversation_ids,
                    user_ids=restored_user_ids,
                )
            except Exception as error:
                logger.warning(
                    "assistant_attachment_promotion_checkpoint_restore_failed",
                    task_id=task_id,
                    run_id=run_id,
                    error=str(error),
                )
            raise

        promoted_records = [
            {**record, "status": "promoted", "promoted_task_id": task_id, "promoted_run_id": run_id}
            for record in records
        ]
        try:
            _write_records_and_indexes(
                records=promoted_records,
                team_id=team_id,
                user_id=user_id,
                conversation_id=conversation_id,
                conversation_ids=conversation_ids,
                user_ids=user_ids,
            )
        except Exception:
            try:
                tasks_facade.rollback_posthog_ai_attachments(
                    task_id=task_id,
                    run_id=run_id,
                    team_id=team_id,
                    attachment_ids=result.newly_attached_ids,
                )
            except Exception as error:
                logger.warning(
                    "assistant_attachment_promotion_rollback_failed",
                    task_id=task_id,
                    run_id=run_id,
                    error=str(error),
                )
            raise

    return AttachmentPromotion(
        attachment_ids=result.attached_ids,
        newly_attached_ids=result.newly_attached_ids,
        task_id=task_id,
        run_id=run_id,
        records=records,
    )


def rollback_attachment_promotion(promotion: AttachmentPromotion | None) -> None:
    if promotion is None or not promotion.newly_attached_ids:
        return

    newly_attached_ids = set(promotion.newly_attached_ids)
    records = [record for record in promotion.records if str(record["id"]) in newly_attached_ids]
    first = records[0]
    team_id = int(first["team_id"])
    user_id = int(first["user_id"])
    conversation_id = UUID(str(first["conversation_id"]))
    try:
        with _cache_locks(
            [
                _user_lock_key(team_id, user_id),
                *(_attachment_lock_key(attachment_id) for attachment_id in promotion.newly_attached_ids),
            ]
        ):
            pending_records = [
                {
                    **record,
                    "status": "rollback_pending",
                    "promoted_task_id": promotion.task_id,
                    "promoted_run_id": promotion.run_id,
                }
                for record in records
            ]
            _write_records_and_indexes(
                records=pending_records,
                team_id=team_id,
                user_id=user_id,
                conversation_id=conversation_id,
                conversation_ids=_get_index(_conversation_index_key(team_id, user_id, conversation_id)),
                user_ids=_get_index(_user_index_key(team_id, user_id)),
            )
    except Exception as error:
        logger.warning(
            "assistant_attachment_rollback_checkpoint_failed",
            task_id=promotion.task_id,
            run_id=promotion.run_id,
            error=str(error),
        )

    try:
        tasks_facade.rollback_posthog_ai_attachments(
            task_id=promotion.task_id,
            run_id=promotion.run_id,
            team_id=team_id,
            attachment_ids=promotion.newly_attached_ids,
        )
    except Exception as error:
        logger.warning(
            "assistant_attachment_detach_failed",
            task_id=promotion.task_id,
            run_id=promotion.run_id,
            error=str(error),
        )
        return

    try:
        with _cache_locks(
            [
                _user_lock_key(team_id, user_id),
                *(_attachment_lock_key(attachment_id) for attachment_id in promotion.newly_attached_ids),
            ]
        ):
            conversation_ids = _get_index(_conversation_index_key(team_id, user_id, conversation_id))
            user_ids = _get_index(_user_index_key(team_id, user_id))
            for attachment_id in promotion.newly_attached_ids:
                if attachment_id not in conversation_ids:
                    conversation_ids.append(attachment_id)
                if attachment_id not in user_ids:
                    user_ids.append(attachment_id)
            _write_records_and_indexes(
                records=records,
                team_id=team_id,
                user_id=user_id,
                conversation_id=conversation_id,
                conversation_ids=conversation_ids,
                user_ids=user_ids,
            )
    except Exception as error:
        logger.warning(
            "assistant_attachment_cache_restore_failed",
            task_id=promotion.task_id,
            run_id=promotion.run_id,
            error=str(error),
        )


def commit_attachment_promotion(promotion: AttachmentPromotion | None) -> None:
    if promotion is None or not promotion.newly_attached_ids:
        return
    first = promotion.records[0]
    tasks_facade.commit_posthog_ai_attachments(
        task_id=promotion.task_id,
        run_id=promotion.run_id,
        team_id=int(first["team_id"]),
        attachment_ids=promotion.newly_attached_ids,
    )
