# Proprietary and confidential. Unauthorized copying prohibited.

"""
Synth — Code synthesis with HITL approval and auth injection

LLMs synthesize one-shot Python tools from natural-language intent.
Every tool passes a mandatory human-in-the-loop approval gate before
execution. Credentials are injected into the sandbox by capability scope
at run time — the LLM never sees your tokens.
"""

__version__ = "0.6.2"

from synth.core.executor import Executor
from synth.core.registry import CapabilityRegistry
from synth.core.synthesizer import Synthesizer
from synth.core.types import (
    ApprovalDecision,
    ApprovalRequest,
    Capability,
    CapabilityAuth,
    RiskLevel,
    SynthesizedTool,
    ToolOutput,
)
from synth.hitl.gate import HITLGate

__all__ = [
    "ApprovalDecision",
    "ApprovalRequest",
    "Capability",
    "CapabilityAuth",
    "CapabilityRegistry",
    "Executor",
    "HITLGate",
    "RiskLevel",
    "SynthesizedTool",
    "Synthesizer",
    "ToolOutput",
]
