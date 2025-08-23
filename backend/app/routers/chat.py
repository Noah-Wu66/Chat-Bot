from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import Any, List, Optional
from datetime import datetime
from bson import ObjectId
from ..core.config import get_settings
from ..core.security import verify_jwt
from ..db.mongo import get_db

from openai import OpenAI

settings = get_settings()
client = OpenAI(api_key=settings.aihubmix_api_key, base_url=settings.aihubmix_base_url)

router = APIRouter()


async def get_auth_user(request: Request):
    token = request.cookies.get("auth_token")
    if not token:
        raise HTTPException(status_code=401, detail="未授权")
    payload = verify_jwt(token, settings.auth_secret)
    if not payload:
        raise HTTPException(status_code=401, detail="未授权")
    return payload


class ToolSchema(BaseModel):
    type: str
    name: str
    description: str
    parameters: dict


class MessageInput(BaseModel):
    content: str
    images: Optional[List[str]] = None


class ChatBody(BaseModel):
    conversationId: Optional[str] = None
    message: MessageInput
    model: str
    settings: dict = {}
    useTools: bool = False
    stream: bool = False


@router.post("")
async def chat(body: ChatBody, user=Depends(get_auth_user)):
    db = await get_db()

    if body.stream:
        # 为简化落地，此处先走非流式；需要流式可改为 StreamingResponse + sse
        pass

    # 获取或创建对话
    if body.conversationId:
        conv = await db.Conversation.find_one({"id": body.conversationId, "userId": user["sub"]})
        if not conv:
            raise HTTPException(status_code=404, detail="对话不存在")
    else:
        title = (body.message.content[:50] + ("..." if len(body.message.content) > 50 else ""))
        now = datetime.utcnow()
        conv = {
            "id": str(ObjectId()),
            "userId": user["sub"],
            "title": title,
            "messages": [],
            "createdAt": now,
            "updatedAt": now,
            "model": body.model,
            "settings": body.settings or {},
        }
        await db.Conversation.insert_one(conv)

    # 追加用户消息
    user_msg = {
        "id": str(ObjectId()),
        "role": "user",
        "content": body.message.content,
        "timestamp": datetime.utcnow(),
        "model": body.model,
        **({"images": body.message.images} if body.message.images else {}),
    }
    await db.Conversation.update_one({"id": conv["id"], "userId": user["sub"]}, {"$push": {"messages": user_msg}, "$set": {"updatedAt": datetime.utcnow()}})

    # 组装 Chat Completions 消息
    history = []
    for m in conv.get("messages", []):
        history.append({"role": m["role"], "content": m["content"]})
    history.append({"role": "user", "content": body.message.content})

    params: dict[str, Any] = {
        "model": body.model,
        "messages": history,
    }
    if "temperature" in body.settings:
        params["temperature"] = body.settings.get("temperature")
    if "maxTokens" in body.settings:
        params["max_tokens"] = body.settings.get("maxTokens")
    if "topP" in body.settings:
        params["top_p"] = body.settings.get("topP")
    if "frequencyPenalty" in body.settings:
        params["frequency_penalty"] = body.settings.get("frequencyPenalty")
    if "presencePenalty" in body.settings:
        params["presence_penalty"] = body.settings.get("presencePenalty")
    if "seed" in body.settings:
        params["seed"] = body.settings.get("seed")

    completion = client.chat.completions.create(**params)

    choice = completion.choices[0]
    assistant_content = choice.message.content

    assistant_msg = {
        "id": str(ObjectId()),
        "role": "assistant",
        "content": assistant_content,
        "timestamp": datetime.utcnow(),
        "model": body.model,
        "metadata": {"tokensUsed": completion.usage.total_tokens if getattr(completion, "usage", None) else None},
    }
    await db.Conversation.update_one({"id": conv["id"], "userId": user["sub"]}, {"$push": {"messages": assistant_msg}, "$set": {"updatedAt": datetime.utcnow()}})

    return {
        "message": assistant_msg,
        "conversationId": conv["id"],
        "usage": getattr(completion, "usage", None),
    }


