# codemode k6 load tests — 10-user UAT pack
#
# Usage:
#   export API_KEY=awc_…
#   make all                 # run every scenario sequentially
#   make burst-spawn         # one scenario
#   BASE_URL=… make all      # override target

K6 ?= $(shell command -v k6 || echo $$HOME/bin/k6)
BASE_URL ?= https://chat.example.com
DIR := $(dir $(realpath $(firstword $(MAKEFILE_LIST))))

ifndef API_KEY
$(error API_KEY env var is required — export an awc_… key with code+chat scopes)
endif

ENV := BASE_URL=$(BASE_URL) API_KEY=$(API_KEY)

.PHONY: all burst-spawn chat-completions preview-proxy ws-soak session-churn

all: burst-spawn chat-completions preview-proxy ws-soak session-churn

burst-spawn:
	@echo ">>> 01 burst-spawn (10 users)"
	@$(ENV) $(K6) run $(DIR)01-burst-spawn.js

chat-completions:
	@echo ">>> 02 chat-completions (10 users sustained)"
	@$(ENV) $(K6) run $(DIR)02-chat-completions.js

preview-proxy:
	@echo ">>> 03 preview-proxy (10 concurrent paths)"
	@$(ENV) $(K6) run $(DIR)03-preview-proxy.js

ws-soak:
	@echo ">>> 04 ws-soak (10 long-held connections)"
	@$(ENV) $(K6) run $(DIR)04-ws-soak.js

session-churn:
	@echo ">>> 05 session-churn (spawn/idle/cleanup loops)"
	@$(ENV) $(K6) run $(DIR)05-session-churn.js
