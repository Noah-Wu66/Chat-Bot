from fastapi import APIRouter, HTTPException, Response, Depends
from pydantic import BaseModel
from datetime import datetime
from bson import ObjectId
import hashlib
import os

from ..core.config import get_settings
from ..core.security import sign_jwt, verify_jwt
from ..db.mongo import get_db

router = APIRouter()
settings = get_settings()


class LoginInput(BaseModel):
    identifier: str
    password: str
    remember: bool | None = False


class RegisterInput(BaseModel):
    username: str
    email: str
    password: str
    confirmPassword: str


def scrypt_hash(password: str, salt: bytes | None = None) -> str:
    import hashlib, os
    salt = salt or os.urandom(16)
    key = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=64)
    return f"scrypt:{salt.hex()}:{key.hex()}"


def scrypt_verify(password: str, stored: str) -> bool:
    try:
        scheme, salt_hex, key_hex = stored.split(":")
        if scheme != "scrypt":
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(key_hex)
        import hmac
        derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=len(expected))
        return hmac.compare_digest(derived, expected)
    except Exception:
        return False


@router.post("/login")
async def login(payload: LoginInput, response: Response):
    db = await get_db()
    user = await db.User.find_one({
        "$or": [{"username": payload.identifier}, {"email": payload.identifier}]
    })
    if not user or not scrypt_verify(payload.password, user.get("passwordHash", "")):
        raise HTTPException(status_code=401, detail="账号或密码错误")

    token = sign_jwt(
        {"sub": user["id"], "username": user["username"], "email": user["email"]},
        settings.auth_secret,
        60 * 60 * 24 * 30 if payload.remember else None,
    )
    response.set_cookie(
        key="auth_token",
        value=token,
        httponly=True,
        samesite="none",
        secure=True,
        max_age=60 * 60 * 24 * 30 if payload.remember else None,
        path="/",
    )
    return {"success": True, "redirect": "/", "token": token}


@router.post("/register")
async def register(payload: RegisterInput):
    if payload.password != payload.confirmPassword:
        raise HTTPException(status_code=400, detail="两次输入的密码不一致")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="密码至少8位")

    db = await get_db()
    taken = await db.User.find_one({"$or": [{"username": payload.username}, {"email": payload.email}]})
    if taken:
        raise HTTPException(status_code=409, detail="用户名或邮箱已被占用")

    user_id = str(ObjectId())
    await db.User.insert_one({
        "id": user_id,
        "username": payload.username,
        "email": payload.email,
        "passwordHash": scrypt_hash(payload.password),
        "createdAt": datetime.utcnow(),
    })
    return {"success": True, "redirect": "/login"}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("auth_token", path="/")
    return {"success": True, "redirect": "/login"}


