"""/health names the GenAI provider whenever it is not SAP AI Core."""

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def genai_health(tmp_path: Path, **values: Any) -> dict[str, Any]:
    settings = Settings(database_path=tmp_path / "reroute.db", **values)
    with TestClient(create_app(settings)) as client:
        body: dict[str, Any] = client.get("/health").json()["genai"]
    return body


def test_mock_mode_names_no_provider(tmp_path: Path) -> None:
    assert genai_health(tmp_path) == {
        "mode": "mock",
        "source": "simulated",
        "integration_status": "not_implemented",
    }


def test_gemini_is_named_and_reported_configured(tmp_path: Path) -> None:
    genai = genai_health(tmp_path, use_mock_genai=False, gemini_api_key="k-not-real")

    assert genai["mode"] == "live"
    assert genai["provider"] == "gemini"
    assert genai["integration_status"] == "configured"
    assert "k-not-real" not in str(genai)


def test_an_openai_compatible_gateway_is_named(tmp_path: Path) -> None:
    genai = genai_health(
        tmp_path,
        use_mock_genai=False,
        llm_base_url="https://openrouter.ai/api/v1",
        llm_api_key="k-not-real",
        llm_model="meta-llama/llama-3.3-70b-instruct:free",
    )

    assert genai["provider"] == "openrouter"
    assert genai["integration_status"] == "configured"


def test_sap_ai_core_is_the_unnamed_default(tmp_path: Path) -> None:
    genai = genai_health(tmp_path, use_mock_genai=False, genai_provider="sap")

    assert "provider" not in genai
    assert genai["integration_status"] == "not_implemented"
