# Proprietary and confidential. Unauthorized copying prohibited.

"""
LLM Client Adapters

Provides adapters for various LLM providers to work with the Synthesizer.
All clients implement a simple protocol: async complete(system, prompt) -> str
"""

import asyncio
import os
from typing import Any, Protocol

import httpx

_JSON_CONTENT_TYPE = "application/json"


class LLMClient(Protocol):
    """Protocol that all LLM clients must implement."""
    model: str

    async def complete(self, system: str, prompt: str, **kwargs: Any) -> str:  # pragma: no cover
        """Generate a completion."""
        ...


class AnthropicClient:
    """
    Anthropic Claude client for tool synthesis.
    """

    def __init__(
        self,
        api_key: str | None = None,
        model: str = "claude-sonnet-4-20250514",
        max_tokens: int = 16384,
        base_url: str | None = None,
    ) -> None:
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not self.api_key:
            raise ValueError(
                "Anthropic API key required. Set ANTHROPIC_API_KEY env var or pass api_key."
            )

        self.model = model
        self.max_tokens = max_tokens
        self.base_url = base_url

        from anthropic import AsyncAnthropic
        self._client = AsyncAnthropic(
            api_key=self.api_key,
            base_url=self.base_url,
        )

    async def complete(
        self,
        system: str,
        prompt: str,
        **kwargs: Any,
    ) -> str:
        """Generate a completion using Claude."""
        response = await self._client.messages.create(
            model=kwargs.get("model", self.model),
            max_tokens=kwargs.get("max_tokens", self.max_tokens),
            system=system,
            messages=[
                {"role": "user", "content": prompt}
            ],
        )

        text_parts = []
        for block in response.content:
            if hasattr(block, "text"):
                text_parts.append(block.text)

        return "\n".join(text_parts)


class BedrockClient:
    """
    AWS Bedrock client for Claude models.

    Uses boto3 to call Bedrock's invoke_model API.
    Requires AWS credentials configured (via env vars, ~/.aws/credentials, or IAM role).
    """

    def __init__(
        self,
        model: str = "us.anthropic.claude-sonnet-4-6",
        region: str = "us-east-1",
        max_tokens: int = 16384,
    ) -> None:
        self.model = model
        self.region = region
        self.max_tokens = max_tokens

        import boto3
        self._client = boto3.client("bedrock-runtime", region_name=region)

    async def complete(
        self,
        system: str,
        prompt: str,
        **kwargs: Any,
    ) -> str:
        """Generate a completion using Bedrock."""
        import asyncio
        import json

        model_id = kwargs.get("model", self.model)
        max_tokens = kwargs.get("max_tokens", self.max_tokens)

        request_body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": max_tokens,
            "system": system,
            "messages": [
                {"role": "user", "content": prompt}
            ],
        }

        def invoke():
            response = self._client.invoke_model(
                modelId=model_id,
                body=json.dumps(request_body),
                contentType=_JSON_CONTENT_TYPE,
                accept=_JSON_CONTENT_TYPE,
            )
            response_body = json.loads(response["body"].read())
            return response_body

        loop = asyncio.get_event_loop()
        response_body = await loop.run_in_executor(None, invoke)

        text_parts = []
        for block in response_body.get("content", []):
            if block.get("type") == "text":
                text_parts.append(block.get("text", ""))

        return "\n".join(text_parts)


class VertexAIClient:  # pragma: no cover
    """
    Google Cloud Vertex AI client for Gemini models.

    Uses Application Default Credentials (ADC) — no API keys.
    Requires google-cloud credentials configured via:
    - gcloud auth application-default login
    - GOOGLE_APPLICATION_CREDENTIALS env var
    - GCE/Cloud Run metadata service

    Install with: pip install -e '.[vertex]'

    Coverage excluded: VertexAIClient requires the optional google-genai
    SDK + GCP credentials + a live project, which aren't available in
    the standard `[dev]` test environment. The factory dispatch + import
    error path ARE covered in test_llm.py.
    """

    def __init__(
        self,
        model: str = "gemini-2.5-pro",
        region: str = "us-central1",
        project_id: str | None = None,
        max_tokens: int = 16384,
    ) -> None:
        self.model = model
        self.region = region
        self.max_tokens = max_tokens

        self.project_id = (
            project_id
            or os.environ.get("GOOGLE_CLOUD_PROJECT")
            or os.environ.get("GCLOUD_PROJECT")
            or os.environ.get("GCP_PROJECT")
        )

        try:
            from google import genai
        except ImportError as exc:
            raise ImportError(
                "Vertex AI support requires google-genai. "
                "Install with: pip install -e '.[vertex]'"
            ) from exc

        if not self.project_id:
            # Best-effort auto-discovery from `gcloud config`. We look up the
            # absolute path first so we don't shell out to a partial-path
            # executable (Sonar S607 / Bandit B607 security hotspot).
            import shutil
            import subprocess
            gcloud_bin = shutil.which("gcloud")
            if gcloud_bin:
                try:
                    result = subprocess.run(  # noqa: S603
                        [gcloud_bin, "config", "get-value", "project"],
                        capture_output=True, text=True, timeout=5, check=False,
                    )
                    if result.returncode == 0 and result.stdout.strip():
                        self.project_id = result.stdout.strip()
                except (FileNotFoundError, subprocess.TimeoutExpired):
                    pass

        if not self.project_id:
            raise ValueError(
                "Google Cloud project ID required. Set GOOGLE_CLOUD_PROJECT env var, "
                "run 'gcloud config set project <id>', or pass project_id."
            )

        self._client = genai.Client(
            vertexai=True,
            project=self.project_id,
            location=self.region,
        )

    async def complete(
        self,
        system: str,
        prompt: str,
        **kwargs: Any,
    ) -> str:
        """Generate a completion using Vertex AI (Gemini)."""
        import asyncio

        model_id = kwargs.get("model", self.model)
        max_tokens = kwargs.get("max_tokens", self.max_tokens)

        def invoke():
            response = self._client.models.generate_content(
                model=model_id,
                contents=prompt,
                config={
                    "system_instruction": system,
                    "max_output_tokens": max_tokens,
                },
            )
            return response.text

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, invoke)


class OllamaClient:
    """
    Ollama client for local LLM inference.

    Uses the OpenAI-compatible API endpoint.
    """

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        model: str = "llama3.2",
        max_tokens: int = 16384,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.max_tokens = max_tokens

    async def complete(
        self,
        system: str,
        prompt: str,
        **kwargs: Any,
    ) -> str:
        """Generate a completion using Ollama."""
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{self.base_url}/v1/chat/completions",
                json={
                    "model": kwargs.get("model", self.model),
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": kwargs.get("max_tokens", self.max_tokens),
                    "stream": False,
                },
            )

            if response.status_code != 200:
                raise ValueError(f"Ollama API error: {response.status_code} - {response.text}")

            data = response.json()
            return data["choices"][0]["message"]["content"]


class OpenAICompatibleClient:
    """
    Generic OpenAI-compatible API client.

    Works with any API that implements the OpenAI chat completions format,
    including vLLM, LocalAI, Azure OpenAI, and custom endpoints.
    """

    def __init__(
        self,
        base_url: str,
        api_key: str | None = None,
        model: str = "gpt-4",
        max_tokens: int = 16384,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.max_tokens = max_tokens
        self.extra_headers = headers or {}

    async def complete(
        self,
        system: str,
        prompt: str,
        **kwargs: Any,
    ) -> str:
        """Generate a completion using OpenAI-compatible API."""
        headers = {
            "Content-Type": _JSON_CONTENT_TYPE,
            **self.extra_headers,
        }

        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{self.base_url}/v1/chat/completions",
                headers=headers,
                json={
                    "model": kwargs.get("model", self.model),
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": kwargs.get("max_tokens", self.max_tokens),
                    "stream": False,
                },
            )

            if response.status_code != 200:
                raise ValueError(f"API error: {response.status_code} - {response.text}")

            data = response.json()
            return data["choices"][0]["message"]["content"]


class OpenAgenticAPIClient:
    """
    Client for OpenAgentic's API (chat-dev.openagentic.io).

    Wraps the platform's OpenAI-compatible API for use with Synth.
    The endpoint is at /api/v1/chat/completions (note the /api prefix).
    Model defaults to "auto" which uses the platform's slider-based routing.
    """

    def __init__(
        self,
        base_url: str = "https://chat-dev.openagentic.io",
        api_key: str | None = None,
        model: str = "auto",
        max_tokens: int = 16384,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key or os.environ.get("OPENAGENTIC_API_KEY")
        self.model = model
        self.max_tokens = max_tokens

    async def complete(
        self,
        system: str,
        prompt: str,
        **kwargs: Any,
    ) -> str:
        """Generate a completion using OpenAgentic API."""
        headers = {
            "Content-Type": _JSON_CONTENT_TYPE,
        }

        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{self.base_url}/api/v1/chat/completions",
                headers=headers,
                json={
                    "model": kwargs.get("model", self.model),
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": kwargs.get("max_tokens", self.max_tokens),
                    "stream": False,
                },
            )

            if response.status_code != 200:
                raise ValueError(
                    f"OpenAgentic API error: {response.status_code} - {response.text}"
                )

            data = response.json()
            return data["choices"][0]["message"]["content"]


class MockLLMClient:
    """Mock LLM client for testing without API calls."""

    def __init__(self, responses: list[str] | None = None) -> None:
        self.responses = responses or []
        self.call_count = 0
        self.last_system: str | None = None
        self.last_prompt: str | None = None
        self.model = "mock-model"

    async def complete(self, system: str, prompt: str, **kwargs: Any) -> str:
        # Yield to the event loop so the mock honours the async contract
        # of the LLMClient Protocol (real backends actually await network I/O).
        await asyncio.sleep(0)
        self.last_system = system
        self.last_prompt = prompt
        self.call_count += 1

        if self.responses:
            return self.responses[min(self.call_count - 1, len(self.responses) - 1)]

        return """
CODE:
async def execute(context: dict) -> dict:
    return {"status": "ok", "message": "Mock execution"}

CAPABILITIES_USED: none
REQUESTED_SCOPES: none
RISK_LEVEL: LOW
RISK_REASONING: This is a mock tool with no real side effects
HUMAN_EXPLANATION: This mock tool returns a simple status message for testing.
OUTPUT_SCHEMA: {"type": "object", "properties": {"status": {"type": "string"}}}
"""


def create_llm_client(
    provider: str = "openagentic",
    **kwargs: Any,
) -> LLMClient:
    """
    Factory function to create an LLM client.

    Args:
        provider: One of "openagentic", "anthropic", "bedrock", "vertex", "ollama",
                  "openai", "mock"
        **kwargs: Provider-specific configuration

    Examples:
        # OpenAgentic Platform (default)
        client = create_llm_client("openagentic", api_key="...")

        # Anthropic
        client = create_llm_client("anthropic", api_key="sk-...")

        # AWS Bedrock (uses IAM credentials)
        client = create_llm_client("bedrock")
        client = create_llm_client("bedrock", model="us.anthropic.claude-opus-4-6-v1")

        # Google Vertex AI (uses ADC)
        client = create_llm_client("vertex", project_id="my-project", region="us-east5")

        # Ollama on local or remote machine
        client = create_llm_client("ollama", model="llama3.2")
        client = create_llm_client("ollama", base_url="http://hal:11434", model="qwen2.5:32b")

        # Generic OpenAI-compatible
        client = create_llm_client("openai", base_url="https://your-api.com", api_key="...")
    """
    providers = {
        "openagentic": OpenAgenticAPIClient,
        "anthropic": AnthropicClient,
        "bedrock": BedrockClient,
        "vertex": VertexAIClient,
        "ollama": OllamaClient,
        "openai": OpenAICompatibleClient,
        "mock": MockLLMClient,
    }

    if provider not in providers:
        raise ValueError(f"Unknown provider: {provider}. Available: {list(providers.keys())}")

    return providers[provider](**kwargs)
