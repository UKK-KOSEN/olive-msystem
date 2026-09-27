"""Authentication helpers for FastAPI routes.

Uses token-based sessions stored in the SQLite database (see storage.Store).
Clients send:  Authorization: Bearer <token>
"""
from __future__ import annotations

from fastapi import Depends, Header, HTTPException

from .config import DB_PATH, IS_ACTIVE
from .errors import app_error
from .storage import Store

_store = Store(DB_PATH, initialize_schema=IS_ACTIVE, read_only=not IS_ACTIVE)


def get_store() -> Store:
    return _store


def get_current_user(authorization: str = Header(default="")) -> dict:
    token = ""
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token:
        raise app_error(401, "AUTH_REQUIRED", "認証が必要です")
    user = _store.get_user_by_token(token)
    if user is None:
        raise app_error(401, "AUTH_INVALID_TOKEN", "認証が無効または期限切れです")
    return user


def require_role(role: str):
    """Dependency factory: requires the current user to have `role`."""

    def _dep(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] != role:
            raise app_error(403, "AUTH_FORBIDDEN", "権限がありません")
        return user

    return _dep


# Convenience dependencies
require_admin = require_role("admin")
