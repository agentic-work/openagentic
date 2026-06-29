#!/usr/bin/env python3
"""Unit tests for verify_deployment.assistant_text — the SSE delta reassembler.

Triage context (openagentic harness MEMORY=FAIL): cross-session memory recall is
genuinely working (the model answers the codeword correctly), but the harness
asserted `secret in <raw SSE stream>`. The model streams the answer one token
at a time as separate content_block_delta/text_delta JSON envelopes, and the
tokenizer splits the hyphenated codeword (e.g. `verify-deployment-178...` ->
`verify` `-de` `ployment` `-` `178` `032` `211` `5`), so the contiguous string
never appears in the raw bytes. assistant_text() concatenates the text_delta
payloads so recall assertions run against the actual answer.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verify_deployment import assistant_text  # noqa: E402


SECRET = "verify-deployment-1780322115"


def _fragmented_sse(fragments: list[str], *, prefixed: bool, type_field: bool) -> str:
    """Build an SSE stream that emits each fragment as its own text_delta line.

    prefixed   -> lines start with 'data: ' (real SSE framing)
    type_field -> {"delta": {"type": "text_delta", "text": ...}} vs bare {"delta": {"text": ...}}
    """
    import json as _json

    lines = []
    for frag in fragments:
        if type_field:
            evt = {"type": "content_block_delta", "delta": {"type": "text_delta", "text": frag}}
        else:
            evt = {"type": "content_block_delta", "delta": {"text": frag}}
        body = _json.dumps(evt)
        lines.append(f"data: {body}" if prefixed else body)
    return "\n".join(lines)


# The exact fragmentation captured live against the codeword.
LIVE_FRAGMENTS = ["verify", "-de", "ployment", "-", "178", "032", "211", "5"]


def test_reassembles_tokenizer_split_codeword_data_prefixed():
    stream = _fragmented_sse(LIVE_FRAGMENTS, prefixed=True, type_field=True)
    # The raw stream must NOT contain the contiguous secret (this is why the
    # naive harness check failed).
    assert SECRET not in stream
    assert assistant_text(stream) == SECRET
    assert SECRET in assistant_text(stream)


def test_reassembles_bare_json_lines_without_data_prefix():
    stream = _fragmented_sse(LIVE_FRAGMENTS, prefixed=False, type_field=True)
    assert assistant_text(stream) == SECRET


def test_reassembles_delta_without_explicit_type_field():
    stream = _fragmented_sse(LIVE_FRAGMENTS, prefixed=True, type_field=False)
    assert assistant_text(stream) == SECRET


def test_reassembles_top_level_text_delta_shape():
    # {"type": "text_delta", "text": ...} (no nested delta envelope)
    import json as _json

    lines = [
        f'data: {_json.dumps({"type": "text_delta", "text": frag})}'
        for frag in LIVE_FRAGMENTS
    ]
    stream = "\n".join(lines)
    assert assistant_text(stream) == SECRET


def test_ignores_non_text_events_and_keepalives():
    import json as _json

    lines = [
        "data: [DONE]",  # not JSON
        ": keepalive",   # SSE comment
        "",
        _json.dumps({"type": "message_start"}),
        _json.dumps({"type": "tool_call_complete", "name": "memorize"}),
    ]
    lines += [
        f'data: {_json.dumps({"type": "content_block_delta", "delta": {"type": "text_delta", "text": f}})}'
        for f in ["The", " codeword", " is ", SECRET]
    ]
    stream = "\n".join(lines)
    assert assistant_text(stream) == f"The codeword is {SECRET}"
    assert SECRET in assistant_text(stream)


def test_empty_stream_returns_empty_string():
    assert assistant_text("") == ""
    assert assistant_text(None) == ""  # type: ignore[arg-type]


def test_malformed_json_lines_are_skipped_not_raised():
    stream = "\n".join(
        [
            'data: {not valid json',
            'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
        ]
    )
    assert assistant_text(stream) == "ok"


if __name__ == "__main__":
    import pytest

    raise SystemExit(pytest.main([__file__, "-q"]))
