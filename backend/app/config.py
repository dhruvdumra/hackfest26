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
    # GEMINI_API_KEY is set, then to the OpenAI-compatible gateway, then to the
    # SAP Hub — so a laptop with one provider configured and the others not just
    # works, in the order that is cheapest to obtain.
    genai_provider: Literal["auto", "sap", "gemini", "compatible"] = "auto"
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
    # ── OpenAI-compatible gateway ─────────────────────────────────────────
    # OpenCode Zen, OpenRouter and NVIDIA NIM all speak the same wire format:
    # POST {LLM_BASE_URL}/chat/completions with `Authorization: Bearer <key>`
    # and a {model, messages} body. One client therefore covers all three, and
    # the only thing that differs between them is this pair of values.
    #
    #   OpenCode Zen  https://opencode.ai/zen/v1    (free models, e.g. space-bunny-free)
    #   OpenRouter    https://openrouter.ai/api/v1  (free variants need a ":free" suffix)
    #   NVIDIA NIM    https://integrate.api.nvidia.com/v1
    #
    # Blank base URL -> the provider is treated as unconfigured rather than
    # raising, so a laptop without a key serves the labelled fixture.
    llm_base_url: str = ""
    llm_api_key: SecretStr = SecretStr("")
    # The bare model id as the gateway spells it. OpenRouter's free tier needs
    # the ":free" suffix, e.g. meta-llama/llama-3.3-70b-instruct:free.
    llm_model: str = ""
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
    # How long the Two-Key step waits for Kavya's yes or no before it closes the
    # run with nothing shared. Long on purpose: in the demo the consent click
    # comes minutes after the pipeline finishes. Must be > 0.
    consent_timeout_seconds: float = Field(default=600.0, gt=0)


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
        case "compatible":
            # Both halves, not just the key: a base URL with no key would 401,
            # and a key with no base URL has nowhere to be sent.
            return all(
                value.strip()
                for value in (
                    settings.llm_base_url,
                    settings.llm_api_key.get_secret_value(),
                    settings.llm_model,
                )
            )
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


def resolve_genai_provider(settings: Settings) -> Literal["gemini", "compatible", "sap"]:
    """Decide which provider this process talks to.

    "auto" takes the first provider that is actually configured, in the order
    cheapest to obtain: Gemini (an AI Studio key, about a minute), then an
    OpenAI-compatible gateway (Zen, OpenRouter, NVIDIA NIM — a key each), then
    the SAP Hub. An explicit "sap", "gemini" or "compatible" is honoured even
    when that provider is not configured, so a misconfigured explicit choice
    produces the honest "missing configuration" error instead of silently using
    a different provider than the operator asked for.
    """
    if settings.genai_provider in {"sap", "gemini", "compatible"}:
        return cast('Literal["sap", "gemini", "compatible"]', settings.genai_provider)
    if settings.gemini_api_key.get_secret_value().strip():
        return "gemini"
    if all(
        value.strip()
        for value in (settings.llm_base_url, settings.llm_api_key.get_secret_value())
    ):
        return "compatible"
    return "sap"


def describe_genai_provider(settings: Settings) -> str:
    """A human label for the selected provider, for logs and the preflight.

    Names the concrete gateway when the OpenAI-compatible path is chosen,
    because "compatible" alone would not tell an operator on stage which of
    three services they are actually talking to.
    """
    provider = resolve_genai_provider(settings)
    if provider != "compatible":
        return provider
    host = settings.llm_base_url.split("//")[-1].split("/")[0]
    match host:
        case "opencode.ai":
            return "opencode-zen"
        case "openrouter.ai":
            return "openrouter"
        case host if "nvidia.com" in host:
            return "nvidia-nim"
        case _:
            return f"compatible:{host}"
