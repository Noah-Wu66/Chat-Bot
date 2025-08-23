import os
from pydantic import BaseModel


class Settings(BaseModel):
    mongodb_uri: str
    aihubmix_api_key: str
    aihubmix_base_url: str = "https://aihubmix.com/v1"
    auth_secret: str = "hardcoded-secret"
    allow_origin: str | None = None


def get_settings() -> Settings:
    return Settings(
        mongodb_uri=os.environ.get("MONGODB_URI", ""),
        aihubmix_api_key=os.environ.get("AIHUBMIX_API_KEY", ""),
        aihubmix_base_url=os.environ.get("AIHUBMIX_BASE_URL", "https://aihubmix.com/v1"),
        auth_secret=os.environ.get("AUTH_SECRET")
        or os.environ.get("NEXTAUTH_SECRET")
        or "hardcoded-secret",
        allow_origin=os.environ.get("ALLOW_ORIGIN"),
    )


