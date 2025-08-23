import time
import jwt
from typing import Optional


def sign_jwt(payload: dict, secret: str, expires_in_sec: Optional[int] = None) -> str:
    now = int(time.time())
    body = {**payload, "iat": now}
    if expires_in_sec:
        body["exp"] = now + int(expires_in_sec)
    return jwt.encode(body, secret, algorithm="HS256")


def verify_jwt(token: str, secret: str) -> Optional[dict]:
    try:
        return jwt.decode(token, secret, algorithms=["HS256"])
    except Exception:
        return None


