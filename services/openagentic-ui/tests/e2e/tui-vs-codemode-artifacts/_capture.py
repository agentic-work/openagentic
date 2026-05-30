#!/usr/bin/env python3
"""
Drive openagentic in a PTY and capture per-slash-command terminal screens.

Strategy:
- Boot openagentic with --ollama-host http://hal:11434 --permissive
- For each slash command, spawn a fresh process so the screen is always clean.
- Wait for the prompt to be ready, type "/<cmd>" + Enter, then wait for the
  picker / output to fully render (poll until no new bytes for 4s).
- Capture the rendered pyte screen contents to .txt.
- /quit and let process die.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import pexpect
import pyte

ARTIFACT_DIR = Path(__file__).resolve().parent
ROWS, COLS = 50, 160

COMMANDS = [
    "agents", "btw", "bug", "config", "context", "cost", "doctor",
    "files", "help", "hooks", "init", "mcp", "memory", "migrate-installer",
    "model", "output-style", "permissions", "plan", "pr-comments",
    "release-notes", "resume", "skills", "status", "theme", "tools",
    "upgrade", "version",
]

def make_screen():
    screen = pyte.Screen(COLS, ROWS)
    stream = pyte.ByteStream(screen)
    return screen, stream

def render(screen: pyte.Screen) -> str:
    return "\n".join(line.rstrip() for line in screen.display).rstrip() + "\n"

def feed_until_idle(child, screen, stream, idle_seconds=2.0, max_seconds=15.0):
    start = time.time()
    last_change = time.time()
    while time.time() - start < max_seconds:
        try:
            chunk = child.read_nonblocking(size=8192, timeout=0.3)
            if chunk:
                stream.feed(chunk)
                last_change = time.time()
        except pexpect.TIMEOUT:
            if time.time() - last_change >= idle_seconds:
                return
        except pexpect.EOF:
            return

def capture_one(cmd_name: str) -> None:
    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    env["COLUMNS"] = str(COLS)
    env["LINES"] = str(ROWS)
    boot_cmd = "openagentic --ollama-host http://hal:11434 --permissive --model nemotron3:33b"
    child = pexpect.spawn(
        "/bin/bash", ["-lc", boot_cmd],
        dimensions=(ROWS, COLS),
        env=env,
        encoding=None,
        timeout=60,
    )
    screen, stream = make_screen()

    # Wait for boot to settle
    feed_until_idle(child, screen, stream, idle_seconds=3.0, max_seconds=30.0)

    # Send slash command
    child.send(f"/{cmd_name}")
    time.sleep(0.5)
    child.send("\r")

    # Long settle so pickers/panels fully render
    feed_until_idle(child, screen, stream, idle_seconds=3.0, max_seconds=20.0)

    out_path = ARTIFACT_DIR / f"tui-{cmd_name}.txt"
    out_path.write_text(render(screen))
    print(f"   captured -> {out_path}", flush=True)

    try:
        child.send("\x1b")
        time.sleep(0.2)
        child.send("\x1b")
        time.sleep(0.2)
        child.close(force=True)
    except Exception:
        pass

def main():
    only = sys.argv[1:]
    cmds = only if only else COMMANDS
    for cmd in cmds:
        print(f"[cmd] /{cmd}", flush=True)
        capture_one(cmd)

if __name__ == "__main__":
    main()
