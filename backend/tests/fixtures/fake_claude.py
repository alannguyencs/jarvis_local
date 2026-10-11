#!/usr/bin/env python3
"""Stands in for the `claude` CLI in tests, speaking its stream-json
protocol: it starts, waits for one user message on stdin, then prints events
(with --include-partial-messages: a text delta per word) ending in a
`result`. What it does depends on the question:

  SLEEP    hang (to test the timeout)
  SLOW     write the answer slowly, one word every 0.2 s
  CRASH    exit 1 with a message on stderr
  ERROR    an is_error result
  GARBAGE  print something that is not JSON
  anything else: answer "echo: <question>", with argv in the result so the
  tests can check the flags.

`--resume 00000000-…` exits at once, before reading stdin, as the real CLI
does for a session it doesn't have.
"""

import json
import sys
import time

argv = sys.argv[1:]
resume = argv[argv.index("--resume") + 1] if "--resume" in argv else None
session = resume or "11111111-1111-1111-1111-111111111111"

if resume == "00000000-0000-0000-0000-000000000000":
    print(f"No conversation found with session ID: {resume}", file=sys.stderr)
    sys.exit(1)

line = sys.stdin.readline()
question = json.loads(line)["message"]["content"]


def emit(event):
    print(json.dumps(event), flush=True)


emit({"type": "system", "subtype": "init", "session_id": session})
if "SLEEP" in question:
    time.sleep(30)
if "CRASH" in question:
    print("boom", file=sys.stderr)
    sys.exit(1)
if "GARBAGE" in question:
    print("this is not json")
    sys.exit(0)

error = "ERROR" in question
answer = "Not logged in · Please run /login" if error else f"echo: {question}"
if "--include-partial-messages" in argv and not error:
    for i, word in enumerate(answer.split(" ")):
        text = word if i == 0 else " " + word
        emit({"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": text}}})
        if "SLOW" in question:
            time.sleep(0.2)
emit({
    "type": "result",
    "subtype": "success",
    "is_error": error,
    "result": answer,
    "session_id": session,
    "argv": argv,
})
