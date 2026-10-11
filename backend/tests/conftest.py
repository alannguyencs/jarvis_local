"""Runs before any test module imports the app, so src.configs picks this up."""

import os

# Tests that need a real model load it themselves (test_stt.py, test_tts.py).
os.environ["STT_PRELOAD"] = "false"
os.environ["TTS_PRELOAD"] = "false"
# No Claude processes started ahead of time unless a test asks for them.
os.environ["ASK_PREWARM"] = "false"
