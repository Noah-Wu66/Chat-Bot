from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from typing import Any, Optional, List
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


class ResponsesBody(BaseModel):
    conversationId: Optional[str] = None
    input: Any
    instructions: Optional[str] = None
    model: str
    settings: dict = {}
    useTools: bool = False
    stream: bool = False


@router.post("")
async def create_response(body: ResponsesBody, user=Depends(get_auth_user)):
    db = await get_db()

    # 这里先实现非流式；如需流式可改 StreamingResponse
    # 获取或创建对话
    if body.conversationId:
        conv = await db.Conversation.find_one({"id": body.conversationId, "userId": user["sub"]})
        if not conv:
            raise HTTPException(status_code=404, detail="对话不存在")
    else:
        # 生成标题
        title = "新对话"
        if isinstance(body.input, str):
            title = body.input[:50] + ("..." if len(body.input) > 50 else "")
        elif isinstance(body.input, list):
            text_item = next((i for i in body.input if i.get("type") == "input_text"), None)
            if text_item and text_item.get("text"):
                title = text_item["text"][:50] + ("..." if len(text_item["text"]) > 50 else "")
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

    # 解析用户输入，保存一条用户消息
    user_content = ""
    user_images: List[str] = []
    if isinstance(body.input, str):
        user_content = body.input
    elif isinstance(body.input, list):
        text_item = next((i for i in body.input if i.get("type") == "input_text"), None)
        if text_item:
            user_content = text_item.get("text", "")
        user_images = [i.get("image_url") for i in body.input if i.get("type") == "input_image" and i.get("image_url")]
    else:
        user_content = str(body.input)

    user_msg = {
        "id": str(ObjectId()),
        "role": "user",
        "content": user_content,
        "timestamp": datetime.utcnow(),
        "model": body.model,
        **({"images": user_images} if user_images else {}),
    }
    await db.Conversation.update_one({"id": conv["id"], "userId": user["sub"]}, {"$push": {"messages": user_msg}, "$set": {"updatedAt": datetime.utcnow()}})

    # 调用 Responses API（或在 gpt-5-chat 时回退到 chat.completions）
    model = body.model

    # 组装参数
    params: dict[str, Any] = {"model": model, "input": body.input}
    if body.instructions:
        params["instructions"] = body.instructions
    if "maxTokens" in body.settings:
        params["max_output_tokens"] = body.settings.get("maxTokens")
    if body.settings.get("text"):
        params["text"] = body.settings.get("text")
    if body.settings.get("webSearch"):
        params["web_search_options"] = {}

    # gpt-5-chat 使用 chat.completions
    if model == "gpt-5-chat":
        chat_messages = body.input if isinstance(body.input, list) else [{"role": "user", "content": body.input}]
        completion = client.chat.completions.create(
            model=model,
            messages=chat_messages,
            **({"temperature": body.settings.get("temperature")} if "temperature" in body.settings else {}),
            **({"max_tokens": body.settings.get("maxTokens")} if "maxTokens" in body.settings else {}),
            **({"top_p": body.settings.get("topP")} if "topP" in body.settings else {}),
            **({"frequency_penalty": body.settings.get("frequencyPenalty")} if "frequencyPenalty" in body.settings else {}),
            **({"presence_penalty": body.settings.get("presencePenalty")} if "presencePenalty" in body.settings else {}),
            **({"seed": body.settings.get("seed")} if "seed" in body.settings else {}),
        )
        assistant_content = completion.choices[0].message.content
        tokens_used = getattr(completion, "usage", None).total_tokens if getattr(completion, "usage", None) else None
        used_model = model
    else:
        result = client.responses.create(**params)
        assistant_content = getattr(result, "content", None) or getattr(result, "output", "")
        tokens_used = getattr(result, "usage", None).total_tokens if getattr(result, "usage", None) else None
        used_model = getattr(result, "model", model)

    assistant_msg = {
        "id": str(ObjectId()),
        "role": "assistant",
        "content": assistant_content or "",
        "timestamp": datetime.utcnow(),
        "model": used_model,
        "metadata": {"tokensUsed": tokens_used},
    }
    await db.Conversation.update_one({"id": conv["id"], "userId": user["sub"]}, {"$push": {"messages": assistant_msg}, "$set": {"updatedAt": datetime.utcnow()}})

    return {
        "message": assistant_msg,
        "conversationId": conv["id"],
        "usage": tokens_used,
        "routing": {"model": used_model},
    }


