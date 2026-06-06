import httpx
from core.config import settings

async def send_email(to_email: str, subject: str, html_content: str) -> bool:
    """
    Send email via Resend API
    """
    if not settings.TRANS_EMAIL_API_KEY:
        print(f"Would send email to {to_email}: {subject}")
        return True

    url = "https://api.resend.com/emails"
    headers = {
        "Authorization": f"Bearer {settings.TRANS_EMAIL_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "from": "World Cup Predictor <noreply@worldcup.leeshomeserver.com>",
        "to": [to_email],
        "subject": subject,
        "html": html_content
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            return True
        except Exception as e:
            print(f"Error sending email: {e}")
            return False
