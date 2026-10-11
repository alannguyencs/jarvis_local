"""Jarvis Local backend entry point."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.api.api_router import api_router
from src.configs import settings
from src.services import claude_cli, stt, tts
from src.services.errors import Invalid, NotFound, Timeout, Upstream

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the models now, so the first question is not slow.
    if settings.stt_preload:
        await run_in_threadpool(stt.load)
    if settings.tts_preload:
        await run_in_threadpool(tts.load)
    # A Claude process waits for the first question (see services/claude_cli.py).
    claude_cli.prepare(None)
    yield
    await claude_cli.shutdown()


app = FastAPI(title="Jarvis Local", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.frontend_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.exception_handler(NotFound)
async def not_found(_: Request, exc: NotFound):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(Invalid)
async def invalid(_: Request, exc: Invalid):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.exception_handler(Upstream)
async def upstream(_: Request, exc: Upstream):
    return JSONResponse(status_code=502, content={"detail": str(exc)})


@app.exception_handler(Timeout)
async def timeout(_: Request, exc: Timeout):
    return JSONResponse(status_code=504, content={"detail": str(exc)})


@app.get("/health")
def health():
    return {"status": "ok", "stt_loaded": stt.is_loaded(), "tts_loaded": tts.is_loaded()}
