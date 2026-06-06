import pytest
from httpx import AsyncClient

@pytest.mark.anyio
async def test_request_body_size_limits(client: AsyncClient):
    # 1. Non-upload endpoint (JSON limit is 1MB)
    # Sending >1MB payload
    large_payload = "a" * (1 * 1024 * 1024 + 10)
    response = await client.post("/api/v1/auth/login", content=large_payload)
    assert response.status_code == 413
    assert response.json() == {"detail": "Payload Too Large"}

    # Sending a small payload (should bypass the 413 check)
    response = await client.post("/api/v1/auth/login", content="small")
    assert response.status_code != 413

    # 2. Upload endpoint (Upload limit is 10MB)
    # Sending >10MB upload payload
    huge_upload = "a" * (10 * 1024 * 1024 + 10)
    response = await client.post("/api/v1/leagues/1/logo", content=huge_upload)
    assert response.status_code == 413

    # Sending a 2MB upload payload (should bypass middleware 413, but fail validation/auth at router level, i.e., not 413)
    medium_upload = "a" * (2 * 1024 * 1024)
    response = await client.post("/api/v1/leagues/1/logo", content=medium_upload)
    assert response.status_code != 413


@pytest.mark.anyio
async def test_mobile_redirect(client: AsyncClient):
    # 1. Without header / settings: no redirect
    headers = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)"}
    response = await client.get("/", headers=headers)
    assert response.status_code != 302

    # 2. With header set to 1: redirect to /m/
    headers_redirect = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)",
        "X-Enable-Mobile-Redirect": "1"
    }
    response = await client.get("/", headers=headers_redirect)
    assert response.status_code == 302
    assert response.headers["location"] == "/m/"

    # 3. With force_desktop=1 cookie: no redirect
    headers_cookie = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)",
        "X-Enable-Mobile-Redirect": "1"
    }
    # Pass cookie using custom header cookie syntax since AsyncClient handles headers directly
    headers_cookie["Cookie"] = "force_desktop=1"
    response = await client.get("/", headers=headers_cookie)
    assert response.status_code != 302

