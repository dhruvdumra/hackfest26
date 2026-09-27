from typing import Annotated, cast

from fastapi import Depends, Request

from app.config import Settings
from app.storage.decision_store import DecisionStore
from app.storage.session_store import SessionStore


def get_app_settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def get_app_session_store(request: Request) -> SessionStore:
    return cast(SessionStore, request.app.state.session_store)


def get_app_decision_store(request: Request) -> DecisionStore:
    return cast(DecisionStore, request.app.state.decision_store)


SettingsDependency = Annotated[Settings, Depends(get_app_settings)]
SessionStoreDependency = Annotated[SessionStore, Depends(get_app_session_store)]
DecisionStoreDependency = Annotated[DecisionStore, Depends(get_app_decision_store)]
