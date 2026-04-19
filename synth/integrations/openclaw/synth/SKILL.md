---
name: synth
description: "Synthesize and run one-shot Python tools from plain English. Use for any task no other installed skill covers: AWS/S3/EC2/Lambda/Cost Explorer, GCP/GCS/BigQuery, Azure, GitHub, Slack, Stripe payments and refunds, Postgres/Supabase queries, Notion pages and databases, Jira/Confluence, Linear, Kubernetes/kubectl, Playwright browser automation, Sentry, Gmail/SMTP, Pinecone/Qdrant vector stores, and arbitrary HTTP APIs. Generates sandboxed code, requires human approval, injects scoped credentials at runtime."
homepage: https://github.com/agentic-work/synth
user-invocable: true
metadata:
  {
    "openclaw":
      {
        "emoji": "🧪",
        "requires":
          {
            "bins": ["synth"],
            "env": ["OPENAGENTIC_API_KEY"],
          },
        "primaryEnv": "OPENAGENTIC_API_KEY",
      },
  }
---

Use `synth` when the user asks for something no other installed skill on this OpenClaw instance covers, or when they explicitly say "synthesize a tool", "write me a tool that…", "just do X".

Synth takes a natural-language intent, writes a one-shot Python function, self-grades the risk, requests human approval, then executes in a sandbox with credentials injected by scope at run time. The LLM never sees tokens. Every call must pass approval.

## When to use

- The task needs a capability the user hasn't installed a dedicated skill for
- Bulk or one-off API work spanning multiple services
- The user explicitly invokes synth (`/synth <intent>` or "use synth to…")

## When NOT to use

- Another installed skill covers the task directly — prefer the specific skill
- The task is purely conversational with no external action
- The user denied a prior synth approval this session — do not re-submit without asking

## Invocation

```
synth tool "<intent as a single clear sentence>" [-c CAP [-c CAP ...]]
```

`-c` scopes which capabilities the synthesized code may use. Pick the minimum set — fewer scopes = safer tool = higher approval rate.

### Available capabilities

| Scope      | `-c` values                                                         |
|------------|---------------------------------------------------------------------|
| Cloud      | `aws`, `gcp`, `azure`                                               |
| SaaS       | `github`, `slack`, `stripe`, `notion`, `atlassian`, `linear`, `sentry` |
| Data       | `postgres`, `vector`                                                |
| DevOps     | `kubernetes`, `shell`, `filesystem`                                 |
| Automation | `browser`, `email`                                                  |
| Utility    | `http`, `json`, `datetime`, `data`                                  |

Run `synth caps` at any time to see the full live list; `synth caps show <name>` for scope/auth/HITL risk details.

### Credentials

Synth reads secrets from env vars only — never from chat. If a synth command fails with "Missing credentials…", tell the user to set the matching variable in their OpenClaw config at `skills.entries.synth.env.<VAR>`. **Do not ask the user to paste a token into chat.**

| Capability   | Required env vars                                       |
|--------------|---------------------------------------------------------|
| `github`     | `GITHUB_TOKEN`                                          |
| `slack`      | `SLACK_TOKEN`                                           |
| `stripe`     | `STRIPE_API_KEY`                                        |
| `postgres`   | `DATABASE_URL`                                          |
| `notion`     | `NOTION_TOKEN`                                          |
| `atlassian`  | `ATLASSIAN_SITE`, `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN` |
| `linear`     | `LINEAR_API_KEY`                                        |
| `sentry`     | `SENTRY_AUTH_TOKEN` (optional: `SENTRY_ORG`)            |
| `kubernetes` | ambient `KUBECONFIG` (optional: `KUBE_CONTEXT`)         |
| `browser`    | optional `BROWSER_PROFILE_DIR`                          |
| `email`      | Gmail: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REFRESH_TOKEN` — OR SMTP/IMAP: `SMTP_URL`/`IMAP_URL` |
| `vector`     | backend-specific (`PINECONE_API_KEY`, `QDRANT_URL`+`QDRANT_API_KEY`, `WEAVIATE_URL`+`WEAVIATE_API_KEY`, or reuse `DATABASE_URL` for pgvector) |
| `aws`        | ambient IAM (`AWS_*` env or `~/.aws/credentials` or IAM role) |
| `gcp`        | ambient ADC (`gcloud auth` or `GOOGLE_APPLICATION_CREDENTIALS`) |
| `azure`      | ambient (`az login` or managed identity)                |

### LLM provider

Synth needs one provider configured. Defaults to `openagentic`.

| Provider        | Flag                              | Env                     |
|-----------------|-----------------------------------|-------------------------|
| OpenAgentic     | `--provider openagentic` (default)| `OPENAGENTIC_API_KEY`   |
| Anthropic       | `--provider anthropic`            | `ANTHROPIC_API_KEY`     |
| AWS Bedrock     | `--provider bedrock`              | ambient IAM             |
| Google Vertex   | `--provider vertex --project-id X`| ambient ADC             |
| Ollama          | `--provider ollama --base-url U`  | —                       |
| OpenAI-compatible | `--provider openai --base-url U`| `OPENAI_API_KEY`        |

## Approval flow

Synth prints an approval request with intent, explanation, risk level, risk reasoning, capabilities, and scopes. In interactive (main CLI) sessions the user responds `y`/`n`/`v(iew code)` inline.

**Chat-transport integration (Telegram / Slack / Discord) is a work-in-progress** — for now, run synth from OpenClaw's main session or approve in the terminal where OpenClaw is running. When the OpenClaw approval-button pipeline lands in synth, this skill will auto-emit the structured request.

After approval, synth installs any pip packages its capabilities need, executes in a sandboxed subprocess with a 60s timeout, and prints the result.

## Examples

| User asks                                           | You run                                                                                                           |
|-----------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| "list my S3 buckets"                                | `synth tool "list all my S3 buckets with creation date" -c aws`                                                   |
| "refund the last payment to customer cus_ABC"       | `synth tool "refund the most recent payment for Stripe customer cus_ABC" -c stripe`                               |
| "how many users signed up this month?"              | `synth tool "count users created in the current calendar month" -c postgres`                                      |
| "open a Jira bug from the latest Sentry issue and post to #engineering" | `synth tool "fetch the latest unresolved Sentry issue, open a Jira bug linking to it, post the ticket URL to Slack #engineering" -c sentry -c atlassian -c slack` |
| "dry-run: show the code you'd write to list GCS buckets" | `synth tool "list my GCS buckets with their location and storage class" -c gcp --dry-run`                    |

## Constraints

- Do not fabricate capability names. If a needed scope isn't in the table above, tell the user synth's built-in capabilities need to be extended — link them to the synth repo.
- Do not pipe `echo y` or `yes` into synth to auto-approve. HITL is mandatory by design.
- If synth returns a redactor warning (`🔒 N sensitive values redacted`), surface it verbatim to the user.
- Prefer `--dry-run` when the user says "show me what you'd do" / "don't run it yet".
