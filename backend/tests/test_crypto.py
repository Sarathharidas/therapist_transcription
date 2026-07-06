"""Unit tests for the at-rest encryption module."""

import pytest
from cryptography.fernet import Fernet

from backend.services import crypto


@pytest.fixture(autouse=True)
def _reset_crypto_cache():
    """Clear the cached Fernet before and after each test so env changes take
    effect and no key leaks into other test modules."""
    crypto._fernet = None
    crypto._loaded = False
    yield
    crypto._fernet = None
    crypto._loaded = False


def _use_key(monkeypatch, key):
    """Point ENCRYPTION_KEY at `key` (or clear it) and reset the cached Fernet."""
    if key is None:
        monkeypatch.delenv("ENCRYPTION_KEY", raising=False)
    else:
        monkeypatch.setenv("ENCRYPTION_KEY", key)
    crypto._fernet = None
    crypto._loaded = False


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
    assert token.startswith(crypto.PREFIX)
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
