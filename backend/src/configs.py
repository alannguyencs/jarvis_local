"""Settings, read from the root .env (one env file for the whole app)."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Jarvis Local backend settings. Every field maps to an UPPER_CASE env var."""

    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        env_ignore_empty=True,
    )

    # Browsers allowed to call this API (comma-separated origins).
    frontend_origins: str = "http://localhost:3040,http://127.0.0.1:3040"

    # Speech to text: Parakeet TDT 0.6B v2, MLX weights (see services/stt.py).
    stt_model: str = "mlx-community/parakeet-tdt-0.6b-v2"
    # Load the model at startup, so the first question is not slow. Off in
    # the tests, which load it only when they need it.
    stt_preload: bool = True
    # Longer recordings get a 422; the upload itself is capped in bytes too.
    max_audio_seconds: float = 120.0
    max_upload_bytes: int = 25 * 1024 * 1024

    # Text to speech: Kokoro-82M (see services/tts.py).
    tts_repo: str = "hexgrad/Kokoro-82M"
    tts_lang: str = "a"  # a = American English, b = British English
    tts_voice: str = "af_heart"
    tts_speed: float = 1.0
    # cpu, mps (the Apple GPU) or auto (mps when there is one). cpu is the
    # default: mps is slow the first time it sees each text length, and
    # answers rarely repeat one, so short answers came out 2-3x faster on cpu.
    tts_device: str = "cpu"
    tts_preload: bool = True
    # Longer answers get a 422 (about five minutes of speech).
    max_tts_chars: int = 5000

    # Claude: every question runs `claude -p` (see services/claude_cli.py).
    # ASK_*, not CLAUDE_*: Claude Code sets CLAUDE_EFFORT and friends in the
    # shells it starts, and those would override these.
    ask_cli: str = "claude"
    ask_model: str = "sonnet"
    ask_effort: str = "low"
    ask_timeout_seconds: float = 120.0
    # Outside the repo: Claude also reads CLAUDE.md from parent folders.
    ask_workdir: Path = Path("~/.jarvis_local/workspace")
    # Passed to --tools; empty = no tools, Claude only answers.
    ask_tools: str = ""
    # Skip the user's settings (their hooks would run on every question),
    # MCP servers and skills. Halves the startup time; the login still works.
    ask_isolated: bool = True
    # Start the CLI ahead of time so a question doesn't wait for its ~2 s
    # startup (see services/claude_cli.py). Off in the tests by default.
    ask_prewarm: bool = True
    # A waiting process older than this is replaced, not used.
    ask_warm_max_age_seconds: float = 600.0

    @property
    def ask_workdir_path(self) -> Path:
        return self.ask_workdir.expanduser()

    @property
    def frontend_origin_list(self) -> list[str]:
        return [o.strip() for o in self.frontend_origins.split(",") if o.strip()]


settings = Settings()
