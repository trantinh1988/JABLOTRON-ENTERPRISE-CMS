from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# backend/app/core/config.py → parents: core, app, backend, repo root
REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CMS_", env_file=".env", extra="ignore")

    app_name: str = "Jablotron Enterprise CMS"
    app_code: str = "JABLOTRON_CMS_ENTERPRISE"
    debug: bool = True

    # Tạm tắt kiểm tra bản quyền — đặt True khi hệ thống hoàn thành để mở lại.
    license_enforced: bool = False

    database_url: str = f"sqlite+aiosqlite:///{(BACKEND_ROOT / 'data' / 'cms.db').as_posix()}"
    public_key_path: Path = REPO_ROOT / "keys" / "public_key.pem"
    license_store_path: Path = BACKEND_ROOT / "data" / "license.json"
    hwid_cache_path: Path = BACKEND_ROOT / "data" / "hwid.cache"

    # Jablotron Link USB (JA-100+) — VID 0x16D6 = 5846, PID 0x0008 = 8
    jablotron_vendor_id: int = 0x16D6
    jablotron_product_id: int = 0x0008

    usb_mock_mode: bool = False
    # Hot-plug / enumerate USB Link
    usb_scan_interval_sec: float = 2.0
    # Poll HID states for connected panels (realtime → WebSocket)
    usb_poll_interval_sec: float = 0.2
    # Re-push full device snapshot over WS (reconcile UI even when states unchanged)
    usb_snapshot_interval_sec: float = 2.0
    # panel_live heartbeat so UI shows "Realtime tủ"
    usb_live_heartbeat_sec: float = 1.0
    mock_event_interval_sec: float = 2.0

    @field_validator("jablotron_vendor_id", "jablotron_product_id", mode="before")
    @classmethod
    def parse_usb_id(cls, value: Any) -> Any:
        if isinstance(value, str):
            text = value.strip()
            if text.lower().startswith("0x"):
                return int(text, 16)
            return int(text)
        return value

    # NoDecode: accept comma-separated env (CMS_CORS_ORIGINS) without JSON parsing
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8080",
            "http://127.0.0.1:8080",
        ]
    )

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: Any) -> Any:
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            if text.startswith("["):
                import json

                return json.loads(text)
            return [part.strip() for part in text.split(",") if part.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
