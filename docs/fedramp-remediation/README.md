# OpenAgentic — A+++ / FedRAMP-Readiness Remediation

This directory is the **audit trail** for the campaign that takes the OpenAgentic
OSS source to an **A+++ adversarial grade** and assembles the **FedRAMP High
control-implementation evidence** the codebase can support.

It documents *how* the remediation was done — every fix, why it was made, the
before/after, and the verification evidence — so the work is independently
auditable and so a future upstream sync cannot silently regress it.

## Scope (agreed 2026-06-09)

- **A+++ code**: fix every confirmed audit blocker (security, secret/IP leak,
  completeness, duplication, tech-debt, docs) to a clean OSS-launch bar.
- **FedRAMP-readiness evidence**: produce the NIST 800-53 (High baseline)
  control-implementation matrix the code *can* substantiate — the technical
  foundation an ATO builds on. NOT the full ATO package (SSP/POA&M/3PAO
  assessment/conmon are org-process artifacts beyond the codebase).
- **Full documentation audit trail**: per-fix remediation ledger + control map.

## Phases

| Phase | What | Status |
|---|---|---|
| P0 | Harden `sync-upstream.py` PRESERVE against OSS-only security regressions | ✅ done — see `ledger/P0-preserve-hardening.md` |
| P1 | Full re-sync onto a throwaway audit base (hardened PRESERVE) | pending |
| P2 | Adversarial re-audit (FedRAMP-High + OSS lens) | pending |
| P3 | Remediation to A+++ on a fresh branch off green main (green-gated) | pending |
| P4 | Adversarial re-grade + FedRAMP-readiness evidence package | pending |

## Layout

- `ledger/` — one human-readable record per remediation phase/finding
  (what / why / before→after / verification).
- `evidence/` — machine-readable artifacts (classification outputs, audit
  results, build/test logs, grep proofs) cited by the ledger.
- `control-map/` — NIST 800-53 control-implementation matrix (added in P3/P4).

## Method

Each phase is driven by an Opus-4.8 multi-agent workflow with adversarial
verification. Findings are confirmed by independent agents before any code
changes. Every code change is build-gated (api `tsc` + ui `vite build` + the
no-hardcoding guard) before the next change lands. Git history is the primary
trail; this directory makes it auditable at a glance.
