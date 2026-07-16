"""Privacy-safe authentication observability helpers.

Authentication diagnostics are written as structured JSON to stdout so they
appear in Railway deployment logs.  They deliberately exclude credentials,
JWTs, request bodies, email addresses, names, and clinic names.
"""

import json
import re
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, Optional

from fastapi import Request


AUTH_ATTEMPT_HEADER = "X-Auth-Attempt-ID"
_ATTEMPT_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_CLIENT_EVENT_WINDOW_SECONDS = 300
_CLIENT_EVENT_LIMIT = 30
_client_event_lock = threading.Lock()
_client_event_hits: Dict[str, Deque[float]] = {}

# Defense in depth: these fields must never be added to an auth log call.
_BLOCKED_FIELD_PARTS = (
    "authorization",
    "credential",
    "email",
    "jwt",
    "name",
    "request_body",
    "token",
)


def normalize_attempt_id(value: Optional[str]) -> str:
    """Return a safe caller-provided trace ID, or create a new one."""
    candidate = (value or "").strip()
    if _ATTEMPT_RE.fullmatch(candidate):
        return candidate
    return uuid.uuid4().hex


def request_attempt_id(request: Request) -> str:
    """Resolve and cache the attempt ID associated with a request."""
    existing = getattr(request.state, "auth_attempt_id", None)
    if existing:
        return existing
    # The query-string fallback lets CORS preflight requests carry the same ID;
    # browsers do not include custom header values in the OPTIONS request.
    supplied = request.headers.get(AUTH_ATTEMPT_HEADER) or request.query_params.get(
        "auth_attempt_id"
    )
    attempt_id = normalize_attempt_id(supplied)
    request.state.auth_attempt_id = attempt_id
    return attempt_id


def browser_family(request: Request) -> str:
    """Return a coarse browser family without logging a fingerprintable UA."""
    ua = request.headers.get("user-agent", "").lower()
    if "edg/" in ua:
        return "edge"
    if "firefox/" in ua:
        return "firefox"
    if "chrome/" in ua or "crios/" in ua:
        return "chrome"
    if "safari/" in ua:
        return "safari"
    return "other"


def request_origin(request: Request) -> Optional[str]:
    """Return a bounded Origin value (scheme + host, never a request body)."""
    origin = (request.headers.get("origin") or "").strip()
    return origin[:200] or None


def auth_event(event: str, attempt_id: Optional[str] = None, **fields: Any) -> None:
    """Emit one sanitized JSON record to Railway stdout."""
    record: Dict[str, Any] = {
        "log_type": "auth_audit",
        "event": str(event)[:80],
        "attempt_id": normalize_attempt_id(attempt_id),
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
    }
    for key, value in fields.items():
        key_lc = key.lower()
        if any(blocked in key_lc for blocked in _BLOCKED_FIELD_PARTS):
            continue
        if value is None or isinstance(value, (bool, int, float)):
            record[key] = value
        else:
            record[key] = str(value)[:200]
    print("[auth_audit] " + json.dumps(record, separators=(",", ":"), sort_keys=True), flush=True)


def client_event_allowed(request: Request) -> bool:
    """Small per-worker rate limit for the unauthenticated client-event route."""
    forwarded = request.headers.get("x-forwarded-for", "")
    client_key = forwarded.split(",", 1)[0].strip()
    if not client_key and request.client is not None:
        client_key = request.client.host
    client_key = client_key or "unknown"

    now = time.monotonic()
    cutoff = now - _CLIENT_EVENT_WINDOW_SECONDS
    with _client_event_lock:
        hits = _client_event_hits.get(client_key)
        if hits is None:
            if len(_client_event_hits) >= 5000:
                stale = [
                    key
                    for key, values in _client_event_hits.items()
                    if not values or values[-1] < cutoff
                ]
                for key in stale:
                    _client_event_hits.pop(key, None)
                if len(_client_event_hits) >= 5000:
                    return False
            hits = deque()
            _client_event_hits[client_key] = hits
        while hits and hits[0] < cutoff:
            hits.popleft()
        if len(hits) >= _CLIENT_EVENT_LIMIT:
            return False
        hits.append(now)
        return True
