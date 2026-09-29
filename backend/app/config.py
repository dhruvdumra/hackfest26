from functools import lru_cache
from pathlib import Path
from typing import Literal, cast

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.models import SessionSource


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_path: Path = Path("data/reroute.db")
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )
    use_mock_hana: bool = True
    use_mock_genai: bool = True
    ghost_twin_threshold: int = Field(default=5, ge=0)
    genai_hub_endpoint: str = ""
    genai_hub_client_id: str = ""
    genai_hub_client_secret: SecretStr = SecretStr("")
    genai_hub_model: str = ""
    genai_hub_timeout_seconds: float = Field(default=8.0, gt=0)
    # Which live provider the LLM calls go to. "auto" resolves to Gemini when
    # GEMINI_API_KEY is set and the SAP Hub otherwise, so a laptop with one
    # provider configured and the other not just works.
    genai_provider: Literal["auto", "sap", "gemini"] = "auto"
    # Google AI Studio key, from aistudio.google.com -> Get API key. The free
    # tier needs no billing account. Held as a SecretStr and never logged.
    gemini_api_key: SecretStr = SecretStr("")
    # Any model the key can reach. gemini-2.5-flash is the safe default; the
    # free tier's per-day quota is small, so check AI Studio's rate-limit page
    # before demoing rather than discovering it on stage.
    gemini_model: str = "gemini-2.5-flash"
    # Generative Language API v1beta base. Overridable for regional endpoints
    # and for tests; the path is the model, not a deployment.
    gemini_api_base: str = "https://generativelanguage.googleapis.com/v1beta"
    # Token endpoint for the client-credentials exchange. The SAP trial
    # onboarding email calls it the "Token URL" and gives it as a bare XSUAA
    # host, e.g. https://<tenant>.authentication.<region>.hana.ondemand.com.
    # Blank -> genai_hub falls back to HTTP Basic, which is what the Hub
    # rejected before; set it to get a real bearer token.
    genai_hub_auth_url: str = ""
    # AI resource group the deployment belongs to. Sent as the AI-Resource-Group
    # header SAP AI Core's inference endpoints expect. Blank -> the header is
    # omitted rather than sent empty.
    genai_hub_resource_group: str = ""
    # Seconds of margin subtracted from a token's advertised lifetime before it
    # is considered stale, so a token cannot expire mid-request. Blank or unset
    # -> 30.0. Must be >= 0.
    genai_hub_token_expiry_margin_seconds: float = Field(default=30.0, ge=0)
    hana_host: str = ""
    hana_port: int = Field(default=443, ge=1, le=65535)
    hana_user: str = ""
    hana_password: SecretStr = SecretStr("")
    hana_keep_alive_seconds: float = Field(default=600.0, gt=0)
    hana_query_timeout_seconds: float = Field(default=8.0, gt=0)


@lru_cache
def get_settings() -> Settings:
    return Settings()


def session_source(settings: Settings) -> SessionSource:
    if settings.use_mock_hana or settings.use_mock_genai:
        return "simulated"
    return "local"


def hana_is_configured(settings: Settings) -> bool:
    return all(
        value.strip()
        for value in (
            settings.hana_host,
            settings.hana_user,
            settings.hana_password.get_secret_value(),
        )
    )


def genai_is_configured(settings: Settings) -> bool:
    """Report whether a live LLM provider is actually reachable from config.

    True when the selected provider has every value it needs. A partial
    configuration is False rather than an error, because a half-filled
    GENAI_HUB_* block should send the caller to the labelled fixture rather
    than to an exception on stage.
    """
    match resolve_genai_provider(settings):
        case "gemini":
            return bool(settings.gemini_api_key.get_secret_value().strip())
        case "sap":
            return all(
                value.strip()
                for value in (
                    settings.genai_hub_endpoint,
                    settings.genai_hub_client_id,
                    settings.genai_hub_client_secret.get_secret_value(),
                    settings.genai_hub_model,
                )
            )


def resolve_genai_provider(settings: Settings) -> Literal["gemini", "sap"]:
    """Decide which provider this process talks to.

    "auto" prefers Gemini when a key is present, because it is the one a laptop
    can actually get in under a minute, and falls back to the SAP Hub. An
    explicit "sap" or "gemini" is honoured even when that provider is not
    configured, so a misconfigured explicit choice produces the honest
    "missing configuration" error instead of silently using a different
    provider than the operator asked for.
    """
    if settings.genai_provider in {"sap", "gemini"}:
        return cast('Literal["sap", "gemini"]', settings.genai_provider)
    if settings.gemini_api_key.get_secret_value().strip():
        return "gemini"
    return "sap"
