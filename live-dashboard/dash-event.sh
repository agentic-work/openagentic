#!/usr/bin/env bash
# Post an event to the live dashboard feed. Usage: dash-event.sh "message"
[ -z "$1" ] && exit 0
EV="/home/trent/openagentic/agentic/live-dashboard/events.ndjson"
printf '{"t":"%s","m":%s}\n' "$(date +%H:%M:%S)" "$(printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" >> "$EV"
