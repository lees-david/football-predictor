import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient, ASGITransport, Response
from datetime import datetime, timezone

from api.deps import get_db
from main import app
from models.user import User, UserRole
from models.email_log import EmailLog
from models.email_template import EmailType
from services import email_service
from core.security import create_access_token

@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"

def _user(role=UserRole.admin):
    u = MagicMock(spec=User)
    u.id = 1
    u.email = "admin@example.com"
    u.role = role
    u.is_active = True
    u.display_name = "Admin User"
    return u

def _db():
    session = AsyncMock()
    session.execute = AsyncMock()
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    return session

@pytest.mark.anyio
async def test_send_via_resend_success():
    """Verify that _send_via_resend returns True and the message ID on success."""
    mock_resp = Response(
        status_code=200,
        content=b'{"id": "re_123456789"}'
    )
    with patch("httpx.AsyncClient.post", return_value=mock_resp):
        success, msg_id = await email_service._send_via_resend("test@example.com", "Hello", "<p>hi</p>")
        assert success is True
        assert msg_id == "re_123456789"

@pytest.mark.anyio
async def test_send_via_resend_error():
    """Verify that _send_via_resend returns False and None on error."""
    mock_resp = Response(
        status_code=400,
        content=b'{"message": "Invalid api key"}'
    )
    with patch("httpx.AsyncClient.post", return_value=mock_resp):
        success, msg_id = await email_service._send_via_resend("test@example.com", "Hello", "<p>hi</p>")
        assert success is False
        assert msg_id is None

@pytest.mark.anyio
async def test_resend_webhook_updates_db():
    """Verify that the webhook handler queries and updates EmailLog status correctly."""
    db_session = _db()
    
    mock_log = EmailLog(
        id=123,
        user_id=1,
        email_type=EmailType.welcome,
        subject="Welcome",
        to_address="test@example.com",
        body_html="<p>hi</p>",
        simulated=False,
        status="sent",
        resend_message_id="re_12345"
    )
    
    mock_execute_res = MagicMock()
    mock_execute_res.scalar_one_or_none.return_value = mock_log
    db_session.execute.return_value = mock_execute_res
    
    app.dependency_overrides[get_db] = lambda: db_session
    
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            # Send webhook event
            payload = {
                "type": "email.bounced",
                "data": {
                    "email_id": "re_12345"
                }
            }
            r = await c.post("/api/v1/admin/email/webhook", json=payload)
            assert r.status_code == 200
            assert r.json() == {"ok": True}
            
            assert mock_log.status == "bounced"
            db_session.commit.assert_called()
    finally:
        app.dependency_overrides.pop(get_db, None)
