"""Tests for GET /api/health."""


def test_health_returns_ok_when_db_reachable(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["db"] == "ok"


def test_health_does_not_require_auth(client):
    """Health endpoint must be reachable without a JWT (Railway's uptime check)."""
    resp = client.get("/api/health")
    # Critically NOT 401
    assert resp.status_code == 200
