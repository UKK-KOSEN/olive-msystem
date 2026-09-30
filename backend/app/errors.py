"""Olive-msystem API error codes.

Every API error carries a stable machine-readable ``code`` alongside the
human-readable ``detail``. Clients (and the ops monitor) can distinguish error
classes without parsing localized message strings.

Naming convention: <AREA>_<KIND> (uppercase, underscore-separated).
Codes are intentionally stable: do not rename them once released, because
frontend code and external integrations may switch on them.
"""
from __future__ import annotations

from typing import Any, Dict

from fastapi import HTTPException

# ---------------------------------------------------------------------------
# Error code registry
# ---------------------------------------------------------------------------
#: canonical message terms -> stable machine code
ERROR_CODES: Dict[str, str] = {
    # --- authentication / authorization (401/403) ---
    "AUTH_REQUIRED": "AUTH_REQUIRED",
    "AUTH_INVALID_TOKEN": "AUTH_INVALID_TOKEN",
    "AUTH_BAD_CREDENTIALS": "AUTH_BAD_CREDENTIALS",
    "AUTH_ACCOUNT_DISABLED": "AUTH_ACCOUNT_DISABLED",
    "AUTH_FORBIDDEN": "AUTH_FORBIDDEN",
    "AUTH_USERNAME_TAKEN": "AUTH_USERNAME_TAKEN",
    "AUTH_LOCKED": "AUTH_LOCKED",

    # --- request validation (400/422) ---
    "VALIDATION_ERROR": "VALIDATION_ERROR",
    "VALIDATION_PASSWORD": "VALIDATION_PASSWORD",
    "VALIDATION_FARM_TREES": "VALIDATION_FARM_TREES",
    "VALIDATION_NO_FILENAME": "VALIDATION_NO_FILENAME",
    "VALIDATION_UNSUPPORTED_VIDEO": "VALIDATION_UNSUPPORTED_VIDEO",
    "VALIDATION_UNSUPPORTED_IMAGE": "VALIDATION_UNSUPPORTED_IMAGE",
    "VALIDATION_NO_TIMES": "VALIDATION_NO_TIMES",
    "VALIDATION_TIME_PARSE": "VALIDATION_TIME_PARSE",
    "VALIDATION_FARMER_REQUIRED": "VALIDATION_FARMER_REQUIRED",
    "VALIDATION_EMAIL_REQUIRED": "VALIDATION_EMAIL_REQUIRED",
    "VALIDATION_OBSERVATIONS_LIMIT": "VALIDATION_OBSERVATIONS_LIMIT",
    "VALIDATION_CONTENT_REQUIRED": "VALIDATION_CONTENT_REQUIRED",

    # --- not found (404) ---
    "NOT_FOUND_IMAGE": "NOT_FOUND_IMAGE",
    "NOT_FOUND_VIDEO": "NOT_FOUND_VIDEO",
    "NOT_FOUND_IMAGE_FILE": "NOT_FOUND_IMAGE_FILE",
    "NOT_FOUND_OBSERVATION": "NOT_FOUND_OBSERVATION",
    "NOT_FOUND_TREE": "NOT_FOUND_TREE",
    "NOT_FOUND_STORAGE_FILE": "NOT_FOUND_STORAGE_FILE",
    "NOT_FOUND_FARMER": "NOT_FOUND_FARMER",

    # --- conflict / state (409) ---
    "CONFLICT_VIDEO_ANALYZING": "CONFLICT_VIDEO_ANALYZING",
    "CONFLICT_TREE_ID": "CONFLICT_TREE_ID",
    "CONFLICT_USERNAME": "CONFLICT_USERNAME",

    # --- resource limitations (413/429) ---
    "LIMIT_UPLOAD_TOO_LARGE": "LIMIT_UPLOAD_TOO_LARGE",
    "LIMIT_RATE": "LIMIT_RATE",
    "LIMIT_REGISTRATION": "LIMIT_REGISTRATION",

    # --- server-side / availability (500/503) ---
    "SERVER_UPLOAD_WRITE": "SERVER_UPLOAD_WRITE",
    "SERVER_ANALYSIS_FAILED": "SERVER_ANALYSIS_FAILED",
    "SERVER_INTERNAL": "SERVER_INTERNAL",
    "UNAVAILABLE_DATABASE": "UNAVAILABLE_DATABASE",
    "UNAVAILABLE_BACKEND": "UNAVAILABLE_BACKEND",
    "UNAVAILABLE_NOT_READY": "UNAVAILABLE_NOT_READY",
}


def app_error(status_code: int, code: str, detail: str, **extra: Any) -> HTTPException:
    """Raise a FastAPI HTTPException carrying a stable machine code.

    The ``code`` is attached to the exception object and rendered into the
    JSON body by the StarletteHTTPException handler in main.py. Existing
    clients that only read ``detail`` are unaffected.

    Example:
        raise app_error(409, "CONFLICT_VIDEO_ANALYZING",
                        "動画は既に解析中です")
    """
    exc = HTTPException(status_code=status_code, detail=detail)
    exc.err_code = code  # type: ignore[attr-defined]
    exc.err_extra = extra  # type: ignore[attr-defined]
    return exc


def error_body(exc: HTTPException) -> Dict[str, Any]:
    """Build the JSON body for a raised exception, merging any error code."""
    code = getattr(exc, "err_code", None)
    extra = getattr(exc, "err_extra", None) or {}
    body: Dict[str, Any] = {"detail": exc.detail}
    if code:
        body["code"] = code
        if extra:
            body["extra"] = extra
    return body