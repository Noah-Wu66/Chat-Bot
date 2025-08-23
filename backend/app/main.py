from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import auth, conversations, chat, responses
from .core.config import get_settings

app = FastAPI(title="Chat-Bot Backend")

# CORS: 单应用部署时通常经由 Next 重写，无需跨域；
# 若配置了 ALLOW_ORIGIN，则精确放行并允许凭证；否则开放为 * 且不携带凭证。
_settings = get_settings()
_allow_origin = _settings.allow_origin
if _allow_origin:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[_allow_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(conversations.router, prefix="/api/conversations", tags=["conversations"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(responses.router, prefix="/api/responses", tags=["responses"])

@app.get("/health")
async def health():
    return {"ok": True}


