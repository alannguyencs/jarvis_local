# Jarvis Local — Implementation Plan (Overview)

Jarvis Local is a voice assistant that runs on this Mac only. The user speaks
a question, the backend turns it into text, asks Claude, turns Claude's answer
back into speech, and the browser plays it. The user can then ask the next
question, and Claude remembers the conversation.

It copies the shape of `alannguyencs/jarvis` (FastAPI backend, React + Vite
frontend, one root `.env`, one `start_app.sh`). It drops sign-in, Postgres
and the production frontend serving, because it runs on localhost only.

## 1. The Voice Loop

```
 Browser                         Backend (FastAPI, 127.0.0.1)
 ───────                         ───────────────────────────
 hold mic button
 MediaRecorder → audio blob
        ── POST /api/stt ──────▶ ffmpeg → 16 kHz mono WAV
                                 Parakeet TDT 0.6B v2 → text
        ◀── {text} ────────────
 show "You: …"
        ── POST /api/ask ──────▶ claude -p --model sonnet --effort low
                                   --resume <session_id> (from turn 2)
        ◀── {answer, session_id}
 show "Jarvis: …"
        ── POST /api/tts ──────▶ strip markdown → Kokoro-82M → 24 kHz WAV
        ◀── audio/wav ─────────
 play answer
 mic ready for the next query
```

The three steps are three separate calls, not one. The frontend can then show
the transcript as soon as it exists and show which step is running. Each step
can also be tested and replaced on its own.

## 2. Tech Choices

| Part | Choice | Why |
|------|--------|-----|
| Backend | FastAPI + uvicorn, Python 3.12 | Same as jarvis. Kokoro needs Python < 3.13. The default `python3` here is 3.10, so use `/opt/homebrew/bin/python3.12` for the venv |
| Frontend | React 19 + Vite 7 + plain CSS | Same as jarvis, with its dark slate/sky palette in `index.css` |
| STT | `nvidia/parakeet-tdt-0.6b-v2` through **`parakeet-mlx`** | The official route (NVIDIA NeMo) is built for CUDA and is heavy. This Mac is an Apple M4, and `parakeet-mlx` runs the same weights on the Apple GPU. Keep a NeMo CPU route behind the same interface as a fallback |
| TTS | `hexgrad/Kokoro-82M` through the **`kokoro`** pip package (`KPipeline`, lang `a`, voice `af_heart`) on the **CPU** | The reference package. The `espeak-ng` it uses for words outside its dictionary comes bundled through pip (`espeakng-loader`), so no Homebrew install is needed. The Apple GPU (`mps`) is only faster when a text length repeats; every new length costs it about 0.9 s, so on real answers the CPU was 2–3× faster for short text (`TTS_DEVICE=mps` still works) |
| Audio decode | `ffmpeg` (already installed) | The browser records webm/opus (Chrome) or mp4 (Safari). Parakeet wants a 16 kHz mono WAV |
| LLM | `claude -p` (Claude Code 2.1.x, already installed) | Uses the user's own Claude login. No API key is kept in the app |
| Storage | None in v1 | Claude Code keeps each conversation's history itself (`--resume`). A list of past chats can come in a later phase (§8) |
| Auth | None | Bind to `127.0.0.1` only, so nothing else on the network can reach it |

Ports: backend **8040**, frontend **3040**. Jarvis already uses 8030/3030.

## 3. Repository Layout

```
jarvis_local/
├── .env.example            BACKEND_PORT, FRONTEND_PORT, model + claude settings
├── start_app.sh            copied from jarvis: venv (python3.12), npm install,
│                           frees ports, runs uvicorn + vite, logs/
├── backend/
│   ├── requirements.txt
│   ├── src/
│   │   ├── main.py         app, lifespan (loads both models once), CORS,
│   │   │                   error handlers, /health
│   │   ├── configs.py      pydantic-settings, reads root .env
│   │   ├── api/
│   │   │   ├── api_router.py   everything under /api
│   │   │   ├── stt.py          POST /api/stt
│   │   │   ├── ask.py          POST /api/ask, POST /api/ask/stream
│   │   │   └── tts.py          POST /api/tts
│   │   ├── schemas/
│   │   │   └── voice.py        SttOut, AskIn, AskOut, TtsIn
│   │   └── services/
│   │       ├── errors.py       Invalid (422), Upstream (502), Timeout (504)
│   │       ├── audio.py        ffmpeg decode to 16 kHz mono samples
│   │       ├── stt.py          Parakeet wrapper: load(), transcribe(wav)
│   │       ├── claude_cli.py   builds + runs the claude -p subprocess
│   │       ├── speech_text.py  markdown → speakable plain text
│   │       └── tts.py          Kokoro wrapper: load(), synthesize(text) → WAV
│   └── tests/
└── frontend/
    ├── vite.config.js      proxies /api to the backend, envDir ".."
    └── src/
        ├── main.jsx, App.jsx, index.css
        ├── config/appConfig.js
        ├── api/client.js   jarvis's fetch wrapper without the token and 401/403 code
        ├── api/voice.js    stt(blob), ask(text, sessionId), tts(text)
        ├── hooks/useRecorder.js   MediaRecorder start/stop → Blob
        ├── composites/     MicButton, Transcript, StatusLine
        └── pages/VoicePage.jsx    the single page
```

Kept from jarvis: the `api/ → services/` split (routes stay thin and
services hold the logic), domain errors mapped to status codes in `main.py`,
one `.env`, the Vite proxy and `start_app.sh`.

Dropped from jarvis: `AuthGate`, `require_user`, `services/auth.py`,
SQLAlchemy and migrations, the notification socket and the production
`serve_frontend` route.

## 4. Backend

### 4.1 Settings (`configs.py`)

| Env var | Default | Meaning |
|---------|---------|---------|
| `STT_PRELOAD` | `true` | Load Parakeet at startup (off in tests) |
| `FRONTEND_ORIGINS` | `http://localhost:3040,http://127.0.0.1:3040` | CORS |
| `STT_MODEL` | `mlx-community/parakeet-tdt-0.6b-v2` | Weights for parakeet-mlx |
| `TTS_VOICE` | `af_heart` | Kokoro voice |
| `TTS_SPEED` | `1.0` | Kokoro speed |
| `ASK_CLI` | `claude` | Path to the CLI |
| `ASK_MODEL` | `sonnet` | `--model` |
| `ASK_EFFORT` | `low` | `--effort` ("low thinking") |
| `ASK_TIMEOUT_SECONDS` | `120` | Kill the subprocess after this |
| `ASK_WORKDIR` | `~/.jarvis_local/workspace` | cwd for `claude -p`. It is outside the repo because Claude also reads CLAUDE.md from parent folders, and this repo's CLAUDE.md would otherwise be loaded |
| `ASK_TOOLS` | *(empty = no tools)* | Passed to `--tools`. Start with Q&A only and add tools later, on purpose |
| `ASK_ISOLATED` | `true` | Adds `--setting-sources project --strict-mcp-config --disable-slash-commands`, so the user's hooks (a Telegram "Done" message, kanban notices), MCP servers and skills stay out. Startup drops from about 6.4 s to 3 s and the login still works |
| `MAX_AUDIO_SECONDS` | `120` | Longer recordings get a 422 |

### 4.2 Endpoints

| Method + path | Request | Response | Errors |
|---------------|---------|----------|--------|
| `POST /api/stt` | multipart `audio` (webm/ogg/mp4/wav) | `{text, duration_s}` | 422 if empty, too long, can't decode or no speech |
| `POST /api/ask` | `{text, session_id?}` | `{answer, session_id, duration_ms, warm, first_text_ms}` | 422 if text is empty, 502 if claude exits non-zero or gives an error result, 504 on timeout |
| `POST /api/ask/stream` | `{text, session_id?}` | newline-delimited JSON events: `session`, `delta` (text as Claude writes), then `done` (as `/api/ask`) or `error` `{status, detail}` with the status `/api/ask` would give (§4.4.2). The page uses this one | 422 if text is empty (a plain response) |
| `POST /api/tts` | `{text}` | `audio/wav` bytes | 422 if nothing speakable is left |
| `GET /health` | — | `{status, stt_loaded, tts_loaded}` | — |

### 4.3 STT service

- `audio.decode(bytes) -> np.ndarray`: write to a temp file (Safari's mp4
  needs a file ffmpeg can seek), run ffmpeg to get 16 kHz mono 16-bit
  samples, scale them to float32, and check the size and length.
- `stt.load()` runs once in `lifespan`. The first run downloads the weights
  into the Hugging Face cache (~2.4 GB).
- `stt.transcribe(samples) -> str` passes the samples straight to
  parakeet-mlx (`get_logmel` + `generate`), so ffmpeg runs once. It runs in a
  threadpool (`run_in_threadpool`)
  behind an `asyncio.Lock`, so the event loop stays free and the model runs
  one request at a time.

### 4.4 Claude service (`claude_cli.py`)

Command (an argv list, never a shell string). The question goes in on
**stdin** as a stream-json message, so text starting with `-` is never read
as a flag, and the process can be started before the question is known
(§4.4.1):

```
claude -p
  --model sonnet --effort low
  --input-format stream-json      # the question is one JSON message
  --output-format stream-json --verbose
  --append-system-prompt "<VOICE_PROMPT>"
  --tools ""                      # from ASK_TOOLS
  --setting-sources project --strict-mcp-config --disable-slash-commands
                                  # when ASK_ISOLATED
  [--resume <session_id>]         # every turn after the first
```

The settings are `ASK_*`, not `CLAUDE_*`, because Claude Code sets
`CLAUDE_EFFORT` (and other variables) in the shells it starts, and those
would override them. For the same reason the subprocess gets the
environment without `CLAUDE_CODE_*`, `CLAUDE_PID` and `CLAUDE_EFFORT`. When
the app is started from inside Claude Code, those would tie every question
to that session.

- Run with `asyncio.create_subprocess_exec` and `cwd=ASK_WORKDIR`. Wrap it
  in `asyncio.wait_for(..., ASK_TIMEOUT_SECONDS)`. On timeout, kill the
  process and raise `Timeout`.
- Parse the JSON output: take the answer from `result` and the id from
  `session_id`. Check `is_error`. Send `session_id` back to the browser, and
  the browser sends it with the next question. That is how follow-up
  questions keep their context.
- `VOICE_PROMPT` tells Claude the answer will be read aloud. It asks for
  short answers (about 2–5 sentences unless the user asks for more), no
  markdown, tables or code blocks, numbers written as they are spoken, and a
  short spoken summary when a list is needed.
- The JSON keys used are `result`, `session_id`, `is_error` and `subtype`
  (checked on Claude Code 2.1.285). `--resume` keeps the same session id.
  An unknown session exits 1 with "No conversation found" on stderr, which
  becomes a 404. The browser then starts a new conversation.
- The tests swap `ASK_CLI` for `tests/fixtures/fake_claude.py`, so the real
  subprocess path runs, timeout kill included, without calling Claude.

### 4.4.1 Processes started ahead of time (phase 5)

Starting `claude -p` takes about 1.9 s before the question is even sent
(3.4 s for each call, 1.5 s of which is Claude itself). The plain stdin mode
can't be started early, because it gives up after 3 s with no input. The
`--input-format stream-json` mode waits as long as it needs to:

- At startup, and after every answer, the backend starts the next process
  ahead of time. One is for a new conversation and one resumes the latest
  conversation (`--resume <id>`). When a new one is prepared, the older
  conversation's process is stopped, so at most two wait (about 120 MB
  each).
- A question takes the matching waiting process. If there is none, or it
  is older than `ASK_WARM_MAX_AGE_SECONDS` (600), it starts one on the spot.
  The answer is the `result` event.
- A process that is waiting answers about 1.4–1.6 s after the question,
  against 3.4 s for a new one. `ASK_PREWARM=false` turns this off. The
  waiting processes are stopped on shutdown, and they also exit by
  themselves when the backend dies (their stdin closes).
- An unknown `--resume` id makes the prepared process exit at once. Its
  stderr still gives the 404.

### 4.4.2 Streaming the answer

The CLI also runs with `--include-partial-messages`, so it prints a text
delta as Claude writes. `claude_cli.ask_stream()` yields the session id
from the CLI's first (`system`) event, then each delta, then the finished
answer. `ask()` is the same stream read to the end. On the real CLI, the
first words came about 1.25 s after the question, while the whole answer
took 2.1 s, and the gap grows with longer answers.

- `POST /api/ask/stream` sends these as newline-delimited JSON. Failures
  after the response has started are an `error` event carrying the status
  `/api/ask` would have given.
- When the client goes away, the stream is closed and the CLI is killed.
  The conversation still resumes afterwards: tested by killing an answer
  partway, then asking two follow-ups that both remembered it.
- The Vite dev proxy keeps its backend request open when the browser
  cancels. `vite.config.js` closes it, so a cancel reaches the backend.

### 4.5 TTS service

- `speech_text.clean(md) -> str`: remove code blocks (replace each with
  "code omitted"), heading and bullet marks, bold and italics, and links
  (keep the link text). Squeeze the whitespace. This is a backstop in case
  Claude ignores the prompt.
- `tts.load()` runs once in `lifespan`: `KPipeline(lang_code="a",
  device="cpu")` (`TTS_DEVICE=mps` or `auto` for the Apple GPU, with
  `PYTORCH_ENABLE_MPS_FALLBACK=1` for the few ops it lacks). It then speaks
  one word, because the first run is slow. `stt.load()` likewise
  transcribes a second of quiet noise.
- `tts.synthesize(text) -> bytes`: join the chunks Kokoro produces into one
  24 kHz 16-bit WAV with `soundfile`. Same threadpool and lock as STT.
- `POST /api/tts` cleans the text first. It returns 422 when nothing
  speakable is left or the text is over `MAX_TTS_CHARS` (5000), and 502 if
  no audio comes out.
- The round-trip test has Kokoro speak a sentence and Parakeet transcribe it,
  and the words must match.

### 4.6 Requirements

`fastapi`, `uvicorn[standard]`, `python-multipart`, `pydantic>=2.10`,
`pydantic-settings`, `parakeet-mlx`, `kokoro>=0.9.4`, `soundfile`, `numpy`,
`en_core_web_sm` (spaCy's English model, pinned as a wheel URL; without it
Kokoro's English front end pip-installs it on first use, in the middle of a
request), `pytest`, `httpx2` (for the test client).

## 5. Frontend

One page, `VoicePage`:

- **Mic button.** Hold to talk, or tap to start and tap again to stop. Space
  bar works too. It is disabled while a turn is running.
- **Status line.** Shows which step is running: Listening → Transcribing →
  Thinking → Speaking → Ready.
- **Transcript.** The conversation so far as alternating "You" / "Jarvis"
  bubbles, and the answer text appears before the audio plays.
- **Controls.** *Stop speaking* (pauses the audio and frees the mic), *New
  conversation* (forgets `session_id`) and *Replay* on each answer.
- **State.** Kept in React only. `sessionId` and the turns are also saved in
  `sessionStorage`, so a page reload does not lose the chat.
- `useRecorder` asks for the microphone once. It picks a MIME type with
  `MediaRecorder.isTypeSupported` (`audio/webm;codecs=opus`, else
  `audio/mp4`).
- Playback uses an `Audio` element on an object URL. The browser only allows
  audio to play after a user action, and pressing the mic counts as one, so
  playback is not blocked.
- `localhost` counts as a secure context, so `getUserMedia` works over plain
  http.

### 5.1 Speaking from the first sentence

The page reads `/api/ask/stream`: the answer bubble fills in as Claude
writes. `utils/speechChunks.js` (`createChunker`) lets out a piece only
once its sentence is finished, which means whitespace has followed its
`. ! ?`, so the "2." in "2.1" is not an end. Pieces go to a speech queue
(`utils/speechQueue.js`). The queue asks for each piece's audio once the one
before it has arrived, and the page plays the pieces as they come:

- The first piece is the opening sentence, at least 30 characters. If
  that sentence is over 90 characters, the piece ends at the last clause
  break (`, ; : —`) between characters 30 and 90. That piece decides when
  the voice starts, and the voice pauses there anyway.
- Later pieces are at least 200 characters. They are made while the
  earlier ones play: speech is made about 8× faster than it is spoken, and
  the pieces follow with ≤ 10 ms between them.
- Pressing the mic, *Stop speaking* or *New conversation* aborts the
  stream, and the backend kills Claude. What was written stays in the chat.
  The session id arrives before any text, so a follow-up works even after
  a stop partway.
- Thinking (mic disabled) lasts until the first piece can be spoken. From
  then on the mic interrupts.

Measured from releasing the mic to the first sound, on the same three
spoken questions:

| | Phase 5 (whole answer, then speak) | Streaming |
|---|---|---|
| Three facts about the moon | 3.6 s | 2.1–2.5 s |
| Virus vs bacteria | 5.8 s | 2.7 s (5.2 s once, when Claude took 3.5 s to its first words and the opening sentence had no clause break) |
| A tip for sleeping better | 6.1 s | 2.6–2.9 s |

### 5.2 Timing (phase 5)

Every turn logs its steps:
- The backend logs `stt took … ms`, `claude answered in … ms
  (warm|cold, …)` and `tts took … ms for … chars`.
- The page shows each step's time under the answer and writes it to the
  console: `heard 0.5 s · Claude 1.3 s (warm) · sentence 0.2 s · voice
  0.6 s · first sound 2.6 s`. Claude is the time to its first words,
  sentence is the time from there to the first piece that can be spoken,
  and voice is that piece's audio.

## 6. Error Handling

| Case | What the user sees |
|------|--------------------|
| No speech heard | "I didn't catch that — try again." No call to Claude |
| Claude times out, fails, or is not logged in | The error shows as text in the chat. The mic becomes ready again |
| TTS fails | The answer is still shown as text, with a "couldn't speak this" note |
| Mic permission denied | A banner explaining how to allow the microphone |

## 7. Build Phases

| Phase | Work | Done when |
|-------|------|-----------|
| 0 | Scaffold: `.env.example`, `start_app.sh`, empty FastAPI with `/health`, Vite app with one page | `./start_app.sh` serves both. `/health` returns ok |
| 1 | STT: `audio.py`, `stt.py`, `POST /api/stt`. Recorder hook and mic button that show the transcript | Speak and see the correct text. Tests pass using a WAV fixture |
| 2 | Claude: `claude_cli.py`, `POST /api/ask`, session id handled in the browser | Two-turn chat in text with the follow-up remembered. Tests use a fake subprocess |
| 3 | TTS: `speech_text.py`, `tts.py`, `POST /api/tts`, playback | The whole loop works by voice |
| 4 | UX polish: status line, stop and replay, new conversation, error states, Space to talk | Every case in §6 has been tried by hand |
| 5 | Measure each step's time and tune it (warm the models at startup, trim the voice prompt) | Log a time for each step on every turn. Aim for under 6 s from release to first sound on a short question |

## 8. Later (Not in v1)

- **Wake word or voice detection** for hands-free use (Silero VAD in the
  browser).
- **Saved conversations.** A small SQLite table (`conversation_id`,
  `claude_session_id`, `title`, turns), and a sidebar to continue old chats.
- **Tools for Claude**, turned on one by one through `ASK_TOOLS`, such
  as reading the Jarvis board through the `jarvis-command` skill.
- A voice picker and a speed slider.

## 9. Open Questions

1. Should Claude have any tools in v1, or answer questions only? The plan
   assumes no tools.
2. Hold-to-talk or tap-to-toggle as the default? The plan supports both.
3. Which Kokoro voice? The plan uses `af_heart`. Other English voices include
   `am_adam` and `bf_emma`.
