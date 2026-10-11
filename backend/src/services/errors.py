"""Domain errors raised by services; main.py maps them to HTTP status codes."""


class NotFound(Exception):
    """→ 404. The message names what is missing (e.g. a Claude conversation)."""


class Invalid(Exception):
    """→ 422. The input can't be used (empty, too long, no speech)."""


class Upstream(Exception):
    """→ 502. A model or the claude CLI failed."""


class Timeout(Exception):
    """→ 504. The claude CLI took longer than CLAUDE_TIMEOUT_SECONDS."""
