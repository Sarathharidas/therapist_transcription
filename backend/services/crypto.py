"""
Application-layer encryption for sensitive PHI at rest.

Encrypts the transcript / AI summary / clinician notes stored in the
`summaries` table so the database (and its backups / RDS snapshots) holds only
ciphertext. Encryption and decryption happen in the backend process — the
frontend always reads these fields through the API, so it is transparent to the
client.

Two encryption backends are supported; both store ciphertext in the existing
TEXT columns (base64) with a self-describing version marker, so a single column
can hold a mix of plaintext + both formats and `decrypt()` just does the right
thing (backward compatible, gradual migration).

  enc:1:<fernet-token>                     ← Fernet, key from ENCRYPTION_KEY
  enc:2:<b64 sealed-data-key>:<b64 iv+ct>  ← AWS KMS envelope encryption

Mode selection for NEW writes (decryption always dispatches on the marker):
  - KMS_KEY_ID set   → KMS envelope (enc:2)      [preferred / hardened]
  - else ENCRYPTION_KEY set → Fernet (enc:1)
  - else             → plaintext (no-op; dev / tests)

Threat model: both protect a DATABASE-only compromise (stolen backup / snapshot
/ read access). Neither locks out a compromised app server. KMS additionally
means there is no exportable raw key, every decrypt is logged in CloudTrail, and
access is revocable via IAM. See CLAUDE.md.

KMS notes:
  - Uses envelope encryption: KMS mints a per-write data key (GenerateDataKey);
    we AES-256-GCM the text locally, store the KMS-sealed data key beside the
    ciphertext, and drop the plaintext data key. Decrypt asks KMS to unseal it.
  - Decrypted data keys are cached briefly (per sealed key) so repeated reads
    don't hit KMS every time. Writes are infrequent, so each write mints a fresh
    data key (simplest + safest — unique key per row).
  - Auth is via the standard AWS credential chain (IAM role) — no key material
    in the environment, only the non-secret KMS_KEY_ID.
"""

import base64
import os
import threading
import time
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PREFIX_FERNET = "enc:1:"
PREFIX_KMS = "enc:2:"

_NONCE_BYTES = 12  # AES-GCM standard nonce size


def is_encrypted(value: Optional[str]) -> bool:
    """True if a stored value is in any recognised encrypted format."""
    return isinstance(value, str) and (
        value.startswith(PREFIX_FERNET) or value.startswith(PREFIX_KMS)
    )


# ── Fernet backend (ENCRYPTION_KEY) ───────────────────────────────────────

_fernet: Optional[MultiFernet] = None
_fernet_loaded = False


def _get_fernet() -> Optional[MultiFernet]:
    """Lazily build the MultiFernet from ENCRYPTION_KEY (cached). None = unset."""
    global _fernet, _fernet_loaded
    if _fernet_loaded:
        return _fernet
    _fernet_loaded = True
    raw = (os.getenv("ENCRYPTION_KEY") or "").strip()
    if not raw:
        _fernet = None
        return None
    keys = [Fernet(k.strip().encode()) for k in raw.split(",") if k.strip()]
    _fernet = MultiFernet(keys) if keys else None
    return _fernet


# ── KMS backend (KMS_KEY_ID) ──────────────────────────────────────────────

_kms_client_cached = None
_kms_lock = threading.Lock()

# Cache of unsealed data keys: sealed-key(b64) -> (plaintext_key, expires_at).
# Bounds KMS Decrypt calls on repeated reads. Small + TTL'd; cleared wholesale
# when it grows past the cap (simple, good enough at this scale).
_dk_cache: dict = {}
_dk_cache_lock = threading.Lock()
_DK_CACHE_TTL = 300      # seconds
_DK_CACHE_MAX = 500


def _kms_key_id() -> Optional[str]:
    """The configured KMS key ARN/id/alias, or None. Read live (easy to toggle)."""
    return (os.getenv("KMS_KEY_ID") or "").strip() or None


def _kms_client():
    """Lazily create a boto3 KMS client (import deferred so boto3 is only needed
    when KMS is actually used)."""
    global _kms_client_cached
    if _kms_client_cached is None:
        with _kms_lock:
            if _kms_client_cached is None:
                import boto3  # deferred import
                region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION")
                _kms_client_cached = (
                    boto3.client("kms", region_name=region)
                    if region else boto3.client("kms")
                )
    return _kms_client_cached


def _kms_encrypt(text: str) -> str:
    key_id = _kms_key_id()
    resp = _kms_client().generate_data_key(KeyId=key_id, KeySpec="AES_256")
    data_key = resp["Plaintext"]        # 32 raw bytes — use now, then drop
    sealed = resp["CiphertextBlob"]     # data key sealed by the KMS master key
    try:
        nonce = os.urandom(_NONCE_BYTES)
        ct = AESGCM(data_key).encrypt(nonce, text.encode("utf-8"), None)
    finally:
        data_key = None  # best-effort: drop the reference promptly
    return "{}{}:{}".format(
        PREFIX_KMS,
        base64.b64encode(sealed).decode("ascii"),
        base64.b64encode(nonce + ct).decode("ascii"),
    )


def _unwrap_data_key(sealed_b64: str, sealed: bytes) -> bytes:
    """Return the plaintext data key for a sealed key, via cache or a KMS call."""
    now = time.time()
    with _dk_cache_lock:
        hit = _dk_cache.get(sealed_b64)
        if hit is not None and hit[1] > now:
            return hit[0]
    kwargs = {"CiphertextBlob": sealed}
    key_id = _kms_key_id()
    if key_id:
        kwargs["KeyId"] = key_id  # enforce the expected CMK on decrypt
    data_key = _kms_client().decrypt(**kwargs)["Plaintext"]
    with _dk_cache_lock:
        if len(_dk_cache) >= _DK_CACHE_MAX:
            _dk_cache.clear()
        _dk_cache[sealed_b64] = (data_key, now + _DK_CACHE_TTL)
    return data_key


def _kms_decrypt(value: str) -> str:
    body = value[len(PREFIX_KMS):]
    try:
        sealed_b64, blob_b64 = body.split(":", 1)
        sealed = base64.b64decode(sealed_b64)
        blob = base64.b64decode(blob_b64)
    except (ValueError, base64.binascii.Error) as exc:
        raise RuntimeError("Malformed KMS-encrypted value") from exc
    nonce, ct = blob[:_NONCE_BYTES], blob[_NONCE_BYTES:]
    data_key = _unwrap_data_key(sealed_b64, sealed)
    return AESGCM(data_key).decrypt(nonce, ct, None).decode("utf-8")


# ── Public API ────────────────────────────────────────────────────────────

def is_enabled() -> bool:
    """True when any encryption backend is configured (KMS or Fernet)."""
    return _kms_key_id() is not None or _get_fernet() is not None


def encrypt(text: Optional[str]) -> Optional[str]:
    """
    Encrypt a plaintext string for storage.

    - None → None (preserve NULLs).
    - Already-encrypted input → returned unchanged (idempotent; safe for backfill).
    - KMS_KEY_ID set → KMS envelope (enc:2).
    - else ENCRYPTION_KEY set → Fernet (enc:1).
    - else → returned unchanged (encryption disabled).
    """
    if text is None:
        return None
    if is_encrypted(text):
        return text
    if _kms_key_id() is not None:
        return _kms_encrypt(text)
    f = _get_fernet()
    if f is None:
        return text  # encryption disabled — store plaintext
    return PREFIX_FERNET + f.encrypt(text.encode("utf-8")).decode("ascii")


def decrypt(value: Optional[str]) -> Optional[str]:
    """
    Decrypt a stored value, dispatching on its marker.

    - None → None.
    - enc:2 → KMS envelope decrypt.
    - enc:1 → Fernet decrypt.
    - no marker → returned as-is (legacy plaintext passthrough).

    Raises RuntimeError on a misconfiguration (encrypted value but the matching
    backend/key is unavailable) rather than returning junk.
    """
    if value is None:
        return None
    if value.startswith(PREFIX_KMS):
        return _kms_decrypt(value)
    if value.startswith(PREFIX_FERNET):
        f = _get_fernet()
        if f is None:
            raise RuntimeError(
                "Found Fernet-encrypted data but ENCRYPTION_KEY is not set — cannot decrypt."
            )
        try:
            return f.decrypt(value[len(PREFIX_FERNET):].encode("ascii")).decode("utf-8")
        except InvalidToken as exc:
            raise RuntimeError(
                "Failed to decrypt — ENCRYPTION_KEY may be wrong or rotated out."
            ) from exc
    return value  # legacy plaintext
