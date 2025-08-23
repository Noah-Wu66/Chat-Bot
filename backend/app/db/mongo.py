from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from datetime import datetime

from ..core.config import get_settings

settings = get_settings()
client: AsyncIOMotorClient | None = None


async def get_db():
    global client
    if client is None:
        client = AsyncIOMotorClient(settings.mongodb_uri)
    return client.get_default_database()


class Message(BaseModel):
    id: str
    role: Literal["system", "user", "assistant", "function"]
    content: str
    timestamp: datetime
    model: Optional[str] = None
    images: Optional[List[str]] = None
    functionCall: Optional[dict] = None
    functionResult: Optional[dict] = None
    metadata: Optional[dict] = None


class ConversationSettings(BaseModel):
    temperature: Optional[float] = None
    maxTokens: Optional[int] = None
    topP: Optional[float] = None
    frequencyPenalty: Optional[float] = None
    presencePenalty: Optional[float] = None
    seed: Optional[int] = None
    text: Optional[dict] = None
    webSearch: Optional[bool] = None
    stream: Optional[bool] = True


class Conversation(BaseModel):
    id: str
    userId: str
    title: str
    messages: List[Message] = []
    createdAt: datetime
    updatedAt: datetime
    model: str
    settings: ConversationSettings | dict = {}


class User(BaseModel):
    id: str
    username: str
    email: str
    passwordHash: str
    createdAt: datetime


