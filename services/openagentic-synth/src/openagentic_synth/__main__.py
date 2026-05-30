# Copyright 2026 Gnomus.ai
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
OpenAgentic Synth Entry Point

Starts the FastAPI server with full OTEL instrumentation.
"""

import os
import uvicorn
from .telemetry import setup_telemetry
from .logging_config import setup_logging

def main():
    # Initialize telemetry first
    setup_telemetry()
    setup_logging()

    port = int(os.environ.get("OPENAGENTIC_SYNTH_PORT", "8090"))

    uvicorn.run(
        "openagentic_synth.server:app",
        host="0.0.0.0",
        port=port,
        log_level="info",
        access_log=True,
        # Single worker - scaling handled by K8s replicas
        workers=1,
        # Limit connections per worker
        limit_concurrency=10,
        # Timeout for requests
        timeout_keep_alive=5,
    )

if __name__ == "__main__":
    main()
