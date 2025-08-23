from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from bson import ObjectId

from ..core.config import get_settings
from ..core.security import verify_jwt
from ..db.mongo import get_db

router = APIRouter()
settings = get_settings()


async def get_auth_user(request: Request):
    token = request.cookies.get("auth_token")
    if not token:
        raise HTTPException(status_code=401, detail="未授权")
    payload = verify_jwt(token, settings.auth_secret)
    if not payload:
        raise HTTPException(status_code=401, detail="未授权")
    return payload


class CreateConversationInput(BaseModel):
    title: str
    model: str
    settings: dict | None = None


@router.get("")
async def list_or_get(request: Request, id: Optional[str] = None, search: Optional[str] = None, stats: Optional[bool] = False, limit: int = 50, user=Depends(get_auth_user)):
    db = await get_db()
    user_id = user["sub"]

    if stats:
        pipeline = [
            {"$match": {"userId": user_id}},
            {"$group": {"_id": None, "totalConversations": {"$sum": 1}, "totalMessages": {"$sum": {"$size": "$messages"}}, "modelsUsed": {"$addToSet": "$model"}}},
        ]
        stats_res = await db.Conversation.aggregate(pipeline).to_list(length=1)
        return stats_res[0] if stats_res else {"totalConversations": 0, "totalMessages": 0, "modelsUsed": []}

    if id:
        conv = await db.Conversation.find_one({"id": id, "userId": user_id})
        if not conv:
            raise HTTPException(status_code=404, detail="对话不存在")
        return conv

    if search:
        cursor = db.Conversation.find({
            "userId": user_id,
            "$or": [
                {"title": {"$regex": search, "$options": "i"}},
                {"messages.content": {"$regex": search, "$options": "i"}},
            ],
        }).sort("updatedAt", -1).limit(limit)
        return await cursor.to_list(length=limit)

    cursor = db.Conversation.find({"userId": user_id}).sort("updatedAt", -1).limit(limit)
    return await cursor.to_list(length=limit)


@router.post("")
async def create(body: CreateConversationInput, user=Depends(get_auth_user)):
    db = await get_db()
    conv_id = str(ObjectId())
    now = datetime.utcnow()
    doc = {
        "id": conv_id,
        "userId": user["sub"],
        "title": body.title,
        "messages": [],
        "createdAt": now,
        "updatedAt": now,
        "model": body.model,
        "settings": body.settings or {},
    }
    await db.Conversation.insert_one(doc)
    return doc


class UpdateConversationInput(BaseModel):
    id: str
    title: Optional[str] = None
    settings: Optional[dict] = None


@router.put("")
async def update(body: UpdateConversationInput, user=Depends(get_auth_user)):
    db = await get_db()
    conv = await db.Conversation.find_one({"id": body.id, "userId": user["sub"]})
    if not conv:
        raise HTTPException(status_code=404, detail="对话不存在")
    updates = {"updatedAt": datetime.utcnow()}
    if body.title is not None:
        updates["title"] = body.title
    if body.settings is not None:
        updates["settings"] = body.settings
    await db.Conversation.update_one({"id": body.id, "userId": user["sub"]}, {"$set": updates})
    return await db.Conversation.find_one({"id": body.id, "userId": user["sub"]})


@router.delete("")
async def delete(id: str, user=Depends(get_auth_user)):
    db = await get_db()
    await db.Conversation.delete_one({"id": id, "userId": user["sub"]})
    return {"success": True}


