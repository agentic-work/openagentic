"""
DLP / Redaction module for Synth tool output.

Masks sensitive patterns (AWS keys, Azure subscription IDs, tokens, etc.)
in tool output before display. Activated via `--redact` CLI flag.
"""

import re
from dataclasses import dataclass, field
from typing import Any


@dataclass
class RedactionPattern:
    """A named pattern to redact from output."""

    name: str
    pattern: re.Pattern
    replacement: str


# Built-in patterns for common secrets
BUILTIN_PATTERNS: list[RedactionPattern] = [
    RedactionPattern(
        name="AWS Access Key ID",
        pattern=re.compile(r"AKIA[0-9A-Z]{16}"),
        replacement="AKIA****************",
    ),
    RedactionPattern(
        name="AWS Account ID (in ARNs)",
        pattern=re.compile(r"(?<=arn:aws:iam::)\d{12}"),
        replacement="************",
    ),
    RedactionPattern(
        name="Azure Subscription ID",
        pattern=re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"),
        replacement="********-****-****-****-************",
    ),
    RedactionPattern(
        name="IAM User ARN",
        pattern=re.compile(r"arn:aws:iam::\d{12}:user/\S+"),
        replacement="arn:aws:iam::************:user/[REDACTED]",
    ),
    RedactionPattern(
        name="Bearer Token",
        # (?i) already makes the class case-insensitive — don't duplicate a-z/A-Z.
        pattern=re.compile(r"(?i)bearer\s+[a-z0-9._-]{20,}"),
        replacement="Bearer [REDACTED]",
    ),
    RedactionPattern(
        name="GitHub Token",
        pattern=re.compile(r"gh[pousr]_[a-zA-Z0-9]{36,}"),
        replacement="ghx_************************************",
    ),
    RedactionPattern(
        name="Generic API Key",
        pattern=re.compile(r"(?i)(api[_-]?key|token|secret)[\"']?\s*[:=]\s*[\"']?[a-z0-9_-]{20,}"),
        replacement=r"\1: [REDACTED]",
    ),
    RedactionPattern(
        name="Private IP",
        # RFC1918 ranges. The trailing triple ".d.d.d" is hoisted out of each
        # alternative to keep the regex complexity under Sonar's cap.
        pattern=re.compile(
            r"\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)"
            r"(?:\.\d{1,3}){2,3}\b"
        ),
        replacement="***.***.***.***",
    ),
]


@dataclass
class Redactor:
    """Applies redaction patterns to text."""

    patterns: list[RedactionPattern] = field(default_factory=lambda: list(BUILTIN_PATTERNS))
    redaction_count: int = 0

    def redact(self, text: str) -> str:
        """Apply all redaction patterns to text. Returns redacted copy."""
        result = text
        for p in self.patterns:
            result, n = p.pattern.subn(p.replacement, result)
            self.redaction_count += n
        return result

    def redact_any(self, value: Any) -> Any:
        """Redact strings within dicts, lists, or plain strings."""
        if isinstance(value, str):
            return self.redact(value)
        if isinstance(value, dict):
            return {k: self.redact_any(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self.redact_any(item) for item in value]
        return value
