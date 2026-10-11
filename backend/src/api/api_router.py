"""Central API router. Every route lives under /api."""

from fastapi import APIRouter

from src.api import ask, stt, tts

api_router = APIRouter()
api_router.include_router(stt.router, prefix="/api", tags=["stt"])
api_router.include_router(ask.router, prefix="/api", tags=["ask"])
api_router.include_router(tts.router, prefix="/api", tags=["tts"])
