"""Unit tests for the at-rest encryption module."""

import pytest
from cryptography.fernet import Fernet

from backend.services import crypto


def _reset_caches():
    crypto._fernet = None
    crypto._fernet_loaded = False
    crypto._kms_client_cached = None
    crypto._dk_cache = {}


@pytest.fixture(autouse=True)
def _reset_crypto_cache(monkeypatch):
    """Clear cached state before and after each test so env changes take effect
    and nothing (key or KMS client) leaks into other test modules."""
    monkeypatch.delenv("ENCRYPTION_KEY", raising=False)
    monkeypatch.delenv("KMS_KEY_ID", raising=False)
    _reset_caches()
    yield
    _reset_caches()


def _use_key(monkeypatch, key):
    """Point ENCRYPTION_KEY at `key` (or clear it) and reset the cached Fernet."""
    if key is None:
        monkeypatch.delenv("ENCRYPTION_KEY", raising=False)
    else:
        monkeypatch.setenv("ENCRYPTION_KEY", key)
    _reset_caches()


def test_noop_when_no_key(monkeypatch):
    _use_key(monkeypatch, None)
    assert not crypto.is_enabled()
    assert crypto.encrypt("hello") == "hello"        # stored as-is
    assert crypto.decrypt("hello") == "hello"        # read as-is
    assert crypto.encrypt(None) is None
    assert crypto.decrypt(None) is None


def test_round_trip_with_key(monkeypatch):
    _use_key(monkeypatch, Fernet.generate_key().decode())
    assert crypto.is_enabled()

    plaintext = "Therapist: how are you?\nPatient: sad."
    token = crypto.encrypt(plaintext)
    assert token.startswith(crypto.PREFIX_FERNET)
    assert plaintext not in token                    # actually encrypted
    assert crypto.decrypt(token) == plaintext


def test_encrypt_is_idempotent(monkeypatch):
    _use_key(monkeypatch, Fernet.generate_key().decode())
    once = crypto.encrypt("secret")
    twice = crypto.encrypt(once)                     # already encrypted → unchanged
    assert once == twice
    assert crypto.decrypt(twice) == "secret"


def test_legacy_plaintext_passthrough(monkeypatch):
    # With a key set, un-marked (legacy) values decrypt to themselves.
    _use_key(monkeypatch, Fernet.generate_key().decode())
    assert crypto.decrypt("legacy plaintext row") == "legacy plaintext row"


def test_none_preserved(monkeypatch):
    _use_key(monkeypatch, Fernet.generate_key().decode())
    assert crypto.encrypt(None) is None
    assert crypto.decrypt(None) is None


def test_rotation_old_key_still_decrypts(monkeypatch):
    old = Fernet.generate_key().decode()
    new = Fernet.generate_key().decode()

    # Encrypt under the old key.
    _use_key(monkeypatch, old)
    token = crypto.encrypt("rotate me")

    # New key primary, old key retained → still decrypts (MultiFernet).
    _use_key(monkeypatch, f"{new},{old}")
    assert crypto.decrypt(token) == "rotate me"


# ── KMS envelope backend (mocked — no real AWS) ────────────────────────────

class _FakeKMS:
    """Minimal stand-in for a boto3 KMS client. 'Seals' a data key by prefixing
    it; a real KMS wraps it under the master key. Counts calls for cache tests."""

    def __init__(self):
        self.gen_calls = 0
        self.decrypt_calls = 0

    def generate_data_key(self, KeyId, KeySpec):
        self.gen_calls += 1
        dk = os.urandom(32)
        return {"Plaintext": dk, "CiphertextBlob": b"SEALED:" + dk}

    def decrypt(self, CiphertextBlob, KeyId=None):
        self.decrypt_calls += 1
        assert CiphertextBlob.startswith(b"SEALED:")
        return {"Plaintext": CiphertextBlob[len(b"SEALED:"):]}


def _use_kms(monkeypatch):
    fake = _FakeKMS()
    monkeypatch.setenv("KMS_KEY_ID", "arn:aws:kms:test:key/abc")
    _reset_caches()
    monkeypatch.setattr(crypto, "_kms_client", lambda: fake)
    return fake


def test_kms_round_trip(monkeypatch):
    _use_kms(monkeypatch)
    assert crypto.is_enabled()

    pt = "Therapist: how are you?\nPatient: not great."
    token = crypto.encrypt(pt)
    assert token.startswith(crypto.PREFIX_KMS)
    assert pt not in token                 # transcript is actually AES-GCM encrypted
    assert crypto.decrypt(token) == pt


def test_kms_idempotent(monkeypatch):
    _use_kms(monkeypatch)
    once = crypto.encrypt("secret")
    assert crypto.encrypt(once) == once    # already enc:2 → unchanged


def test_kms_preferred_over_fernet(monkeypatch):
    # Both configured → new writes use KMS (enc:2).
    monkeypatch.setenv("ENCRYPTION_KEY", Fernet.generate_key().decode())
    _use_kms(monkeypatch)
    assert crypto.encrypt("hi").startswith(crypto.PREFIX_KMS)


def test_kms_decrypt_cache(monkeypatch):
    fake = _use_kms(monkeypatch)
    token = crypto.encrypt("cache me")
    crypto.decrypt(token)
    crypto.decrypt(token)                  # same sealed key → served from cache
    assert fake.decrypt_calls == 1


def test_kms_and_fernet_both_decode(monkeypatch):
    # A KMS row and a legacy Fernet row coexist and both decrypt.
    fkey = Fernet.generate_key().decode()
    monkeypatch.setenv("ENCRYPTION_KEY", fkey)
    _reset_caches()
    fernet_token = crypto.PREFIX_FERNET + Fernet(fkey.encode()).encrypt(b"old row").decode()

    _use_kms(monkeypatch)                  # KMS now primary; ENCRYPTION_KEY still set
    kms_token = crypto.encrypt("new row")

    assert crypto.decrypt(kms_token) == "new row"
    assert crypto.decrypt(fernet_token) == "old row"
