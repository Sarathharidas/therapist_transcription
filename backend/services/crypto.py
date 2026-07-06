"""
Application-layer encryption for sensitive PHI at rest.

Encrypts the transcript / AI summary / clinician notes stored in the
`summaries` table so the database (and its backups / RDS snapshots) holds only
ciphertext. Encryption and decryption happen in the backend process — the
frontend always reads these fields through the API, so the whole thing is
transparent to the client.

Threat model: this protects against a DATABASE-only compromise (stolen backup,
disk, or read access to just the DB). It does NOT protect against a compromised
app server, which necessarily holds the key. See CLAUDE.md.

Key management:
- Key(s) come from the ENCRYPTION_KEY env var (a Fernet key, url-safe base64).
- Multiple comma-separated keys are supported for rotation: the FIRST key
  encrypts; ALL keys are tried for decryption (MultiFernet). Rotate by prepending
  a new key, re-running the backfill, then dropping the old key.
- Generate a key with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

Behaviour:
- If ENCRYPTION_KEY is unset, encryption is a no-op (values are stored as-is).
  This keeps local dev and the test suite working without a key, and lets the
  feature be enabled purely by setting the env var.
- A short marker prefix ("enc:1:") tags encrypted values, so decrypt() can
  transparently handle a mix of legacy plaintext and encrypted rows during and
  after rollout / backfill.
"""

import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

# Version marker so encrypted values are self-describing and distinguishable
# from legacy plaintext. Bump the number if the scheme ever changes.
PREFIX = "enc:1:"

_fernet: Optional[MultiFernet] = None
_loaded = False


def _get_fernet() -> Optional[MultiFernet]:
    """Lazily build the MultiFernet from ENCRYPTION_KEY (cached). None = disabled."""
    global _fernet, _loaded
    if _loaded:
        return _fernet
    _loaded = True
    raw = (os.getenv("ENCRYPTION_KEY") or "").strip()
    if not raw:
        _fernet = None
        return None
    keys = [Fernet(k.strip().encode()) for k in raw.split(",") if k.strip()]
    _fernet = MultiFernet(keys) if keys else None
    return _fernet


def is_enabled() -> bool:
    """True when an ENCRYPTION_KEY is configured (encryption active)."""
    return _get_fernet() is not None


def encrypt(text: Optional[str]) -> Optional[str]:
    """
    Encrypt a plaintext string for storage.

    - None → None (preserve NULLs).
    - No key configured → returns text unchanged (encryption disabled).
    - Already-encrypted input → returned unchanged (idempotent; safe for backfill).
    - Otherwise → "enc:1:" + Fernet token.
    """
    if text is None:
        return None
    if text.startswith(PREFIX):
        return text  # already encrypted
    f = _get_fernet()
    if f is None:
        return text  # encryption disabled — store plaintext
    token = f.encrypt(text.encode("utf-8")).decode("ascii")
    return PREFIX + token


def decrypt(value: Optional[str]) -> Optional[str]:
    """
    Decrypt a stored value.

    - None → None.
    - No marker prefix → returned as-is (legacy plaintext passthrough).
    - Marked → decrypted with any configured key.

    Raises RuntimeError if a value is encrypted but no key (or a wrong key) is
    available — surfacing a misconfiguration rather than silently returning junk.
    """
    if value is None:
        return None
    if not value.startswith(PREFIX):
        return value  # legacy plaintext
    token = value[len(PREFIX):]
    f = _get_fernet()
    if f is None:
        raise RuntimeError(
            "Found encrypted data but ENCRYPTION_KEY is not set — cannot decrypt."
        )
    try:
        return f.decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError(
            "Failed to decrypt a stored value — ENCRYPTION_KEY may be wrong or rotated out."
        ) from exc
