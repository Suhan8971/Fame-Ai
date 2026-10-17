"""Persist the application-to-shortlist relationship used by recruiter tools."""

import json
import os
import re
import threading

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
APPLICATIONS_PATH = os.path.join(_BASE_DIR, "data", "campaign_applications.json")
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
_store_lock = threading.Lock()


class ApplicationStoreError(Exception):
    pass


def _load():
    if not os.path.isfile(APPLICATIONS_PATH):
        return []
    try:
        with open(APPLICATIONS_PATH) as fh:
            records = json.load(fh)
    except (OSError, ValueError):
        return []
    return records if isinstance(records, list) else []


def _save(records):
    os.makedirs(os.path.dirname(APPLICATIONS_PATH), exist_ok=True)
    tmp = APPLICATIONS_PATH + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(records, fh, indent=2)
    os.replace(tmp, APPLICATIONS_PATH)


def record_application(application_id, candidate_id, campaign_id, status, fit_checked, event):
    """Record a fit-checked application; candidate scans alone are not applications."""
    values = {
        "application_id": str(application_id or "").strip(),
        "candidate_id": str(candidate_id or "").strip(),
        "campaign_id": str(campaign_id or "").strip(),
    }
    if any(not _ID_RE.fullmatch(value) for value in values.values()):
        raise ApplicationStoreError("Invalid application, candidate, or campaign id.")
    status = str(status or "").strip().lower()
    if status not in {"pending", "shortlisted", "rejected"}:
        raise ApplicationStoreError("Invalid application status.")
    if fit_checked is not True:
        raise ApplicationStoreError("A completed campaign fit check is required.")
    if event not in {"fit_check", "status_update"}:
        raise ApplicationStoreError("Invalid campaign application event.")

    record = {**values, "fit_checked": True, "status": status}
    with _store_lock:
        records = _load()
        existing = next((r for r in records if r.get("application_id") == values["application_id"]), None)
        if existing and (
            existing.get("candidate_id") != values["candidate_id"]
            or existing.get("campaign_id") != values["campaign_id"]
        ):
            raise ApplicationStoreError("Application id is already linked to another application.")
        if event == "status_update" and existing is None:
            raise ApplicationStoreError("Campaign application was not registered for this candidate.")
        if existing:
            records[records.index(existing)] = record
        else:
            records.append(record)
        _save(records)
    return record


def has_application(candidate_id):
    with _store_lock:
        return any(
            record.get("candidate_id") == candidate_id and record.get("fit_checked") is True
            for record in _load()
        )


def is_shortlisted(candidate_id):
    with _store_lock:
        return any(
            record.get("candidate_id") == candidate_id
            and record.get("fit_checked") is True
            and record.get("status") == "shortlisted"
            for record in _load()
        )


def shortlisted_candidate_ids():
    with _store_lock:
        return {
            record["candidate_id"]
            for record in _load()
            if record.get("candidate_id")
            and record.get("fit_checked") is True
            and record.get("status") == "shortlisted"
        }