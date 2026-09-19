"""
auth_store.py
--------------
File-backed login credentials (data/users.json). By design there is no
self-registration and no "auto-create an account on first login" fallback
-- the only way into the app is an account that already exists in this
file, created via the Admin panel (POST /api/auth/users).

Passwords are stored in plain text. That is fine for local/personal use
but is not a real security posture -- do not reuse these credentials
anywhere that matters, and treat data/users.json as sensitive if you ever
deploy this for real.
"""

import json
import os
import threading
import time

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(_BASE_DIR, "data")
USERS_PATH = os.path.join(DATA_DIR, "users.json")

ROLES = ("candidate", "recruiter", "brand", "admin")
_store_lock = threading.Lock()

# Bootstrap admin so there's a way into the Admin panel on a fresh install.
# Sign in with this once, then create your real accounts (and optionally
# remove this one) from the Admin panel.
_SEED_USERS = [
    {
        "id": "admin_seed",
        "role": "admin",
        "first_name": "Admin",
        "last_name": "User",
        "email": "admin@fame.ai",
        "password": "admin123",
        "created_at": "2026-01-01T00:00:00Z",
    }
]


class AuthStoreError(Exception):
    pass


def _email_key(email):
    return (email or "").strip().lower()


def _save(users):
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = USERS_PATH + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(users, fh, indent=2)
    os.replace(tmp, USERS_PATH)


def _load():
    if not os.path.isfile(USERS_PATH):
        _save(_SEED_USERS)
        return list(_SEED_USERS)
    with open(USERS_PATH) as fh:
        try:
            return json.load(fh)
        except ValueError:
            return list(_SEED_USERS)


def list_users():
    """All accounts, newest first. Used by the Admin panel's credentials table."""
    with _store_lock:
        users = _load()
    return list(reversed(users))


def find_by_email(email):
    key = _email_key(email)
    with _store_lock:
        users = _load()
    return next((u for u in users if _email_key(u.get("email")) == key), None)


def create_user(role, first_name, last_name, email, password):
    role = (role or "").strip().lower()
    first_name = (first_name or "").strip()
    last_name = (last_name or "").strip()
    email = (email or "").strip()
    password = password or ""

    if role not in ROLES:
        raise AuthStoreError(f"Invalid role: {role}")
    if not first_name or not last_name or not email or not password:
        raise AuthStoreError("First name, last name, email and password are all required.")

    with _store_lock:
        users = _load()
        if any(_email_key(u.get("email")) == _email_key(email) for u in users):
            raise AuthStoreError("An account with this email already exists.")
        user = {
            "id": f"u_{int(time.time() * 1000)}",
            "role": role,
            "first_name": first_name,
            "last_name": last_name,
            "email": email,
            "password": password,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        users.append(user)
        _save(users)
        return user


def update_user(user_id, role, first_name, last_name, email, password=None):
    """
    Edits an existing account. password is optional -- pass None/"" to keep
    the account's current password unchanged (so the admin doesn't have to
    know/retype it just to fix a name or email typo).
    """
    role = (role or "").strip().lower()
    first_name = (first_name or "").strip()
    last_name = (last_name or "").strip()
    email = (email or "").strip()

    if role not in ROLES:
        raise AuthStoreError(f"Invalid role: {role}")
    if not first_name or not last_name or not email:
        raise AuthStoreError("First name, last name and email are all required.")

    with _store_lock:
        users = _load()
        idx = next((i for i, u in enumerate(users) if u.get("id") == user_id), None)
        if idx is None:
            raise AuthStoreError("Account not found.")
        if any(
            i != idx and _email_key(u.get("email")) == _email_key(email)
            for i, u in enumerate(users)
        ):
            raise AuthStoreError("Another account already uses this email.")

        updated = dict(users[idx])
        updated.update({
            "role": role,
            "first_name": first_name,
            "last_name": last_name,
            "email": email,
        })
        if password:
            updated["password"] = password
        users[idx] = updated
        _save(users)
        return updated


def authenticate(email, password, role):
    """Raises AuthStoreError with a user-facing message on any mismatch."""
    user = find_by_email(email)
    if user is None or user.get("password") != password:
        raise AuthStoreError("Invalid email or password.")
    if user.get("role") != (role or "").strip().lower():
        raise AuthStoreError(f"This account is registered as \"{user.get('role')}\". Select that role to sign in.")
    return user
