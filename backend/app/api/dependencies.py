from typing import Annotated, cast

from fastapi import Depends, Request

from app.config import Settings
from app.services.employer_decisions import EmployerDecisionLog
from app.storage.session_store import SessionStore


def get_app_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def get_app_session_store(request: Request) -> SessionStore:
    return cast(SessionStore, request.app.state.session_store)


def get_employer_decisions(request: Request) -> EmployerDecisionLog:
    return cast(EmployerDecisionLog, request.app.state.employer_decisions)


SettingsDependency = Annotated[Settings, Depends(get_app_settings)]
SessionStoreDependency = Annotated[SessionStore, Depends(get_app_session_store)]
EmployerDecisionsDependency = Annotated[EmployerDecisionLog, Depends(get_employer_decisions)]
