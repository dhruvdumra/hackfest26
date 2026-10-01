from fastapi import APIRouter

from app.api.dependencies import SettingsDependency
from app.config import (
    Settings,
    datasphere_is_configured,
    describe_genai_provider,
    genai_is_configured,
    hana_is_configured,
    resolve_genai_provider,
)
from app.models import HealthResponse, IntegrationModeStatus, IntegrationStatus

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse, response_model_exclude_none=True)
def health(settings: SettingsDependency) -> HealthResponse:
    genai = _integration_status(settings.use_mock_genai, _genai_integration_status(settings))
    market = _integration_status(settings.use_mock_market, _market_integration_status(settings))
    return HealthResponse(
        status="ok",
        hana=_integration_status(settings.use_mock_hana, _hana_integration_status(settings)),
        genai=genai.model_copy(update={"provider": _genai_provider(settings)}),
        market=market
        if settings.use_mock_market
        else market.model_copy(update={"provider": _market_provider(settings)}),
    )


def _market_provider(settings: Settings) -> str:
    return "sap_datasphere" if settings.market_provider == "datasphere" else "sap_hana_cloud"


def _hana_integration_status(settings: Settings) -> IntegrationStatus:
    if settings.use_mock_hana:
        return "not_implemented"
    return "configured" if hana_is_configured(settings) else "not_implemented"


def _genai_integration_status(settings: Settings) -> IntegrationStatus:
    if settings.use_mock_genai:
        return "not_implemented"
    return "configured" if genai_is_configured(settings) else "not_implemented"


def _genai_provider(settings: Settings) -> str | None:
    # Named whenever it is not SAP AI Core, the documented default, so an answer
    # from Gemini or a gateway can never be read as AI Core being live.
    if settings.use_mock_genai or resolve_genai_provider(settings) == "sap":
        return None
    return describe_genai_provider(settings)


def _market_integration_status(settings: Settings) -> IntegrationStatus:
    if settings.use_mock_market:
        return "not_implemented"
    if settings.market_provider == "datasphere":
        configured = datasphere_is_configured(settings)
    else:
        configured = not settings.use_mock_hana and hana_is_configured(settings)
    return "configured" if configured else "not_implemented"


def _integration_status(
    use_mock: bool,
    integration_status: IntegrationStatus,
) -> IntegrationModeStatus:
    if use_mock:
        return IntegrationModeStatus(mode="mock", source="simulated")
    return IntegrationModeStatus(mode="live", source="live", integration_status=integration_status)
