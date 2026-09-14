# Cloud agents and OpenRouter

The web Agents page manages hosted text-reply agents through the existing
same-origin `/keeper/*` service. Its implementation lives in the separate
`Duval-Software/glass-hive` repository under `cmd/agentkeeper`; the local checkout
is `/Users/sean/orca/projects/glass-hive`.

## Connection

- `GET /keeper/health` advertises `{ models: [{ id, provider, label }] }` from the
  server's model allowlist. Older services retain Echo/Anthropic options only.
- Creation and adoption recheck the catalog before sending a provider key through
  the existing NIP-98 signed request. OpenRouter always requires the member's own
  `sk-or-…` key; it never uses the platform Anthropic key.
- The keeper encrypts keys using its existing secretbox store and `AK_MASTER_KEY`.
  Keys stay out of community events and browser persistence. Provider calls run
  on the keeper, never directly in the browser.
- Supported OpenRouter IDs are `anthropic/claude-sonnet-4.6`,
  `google/gemini-2.5-flash`, and `openai/gpt-4.1-mini`, prefixed with `openrouter:`
  in keeper requests. Changes belong in the server allowlist.
- Existing per-channel cooldowns, agent count limits, and token budgets remain.
  Token counters are process-local and reset on restart; they are not a hard
  dollar spending limit. Model usage is billed to the member's provider account.

## Deployment handoff

Both the web change and the `glass-hive` agentkeeper change must be deployed to
enable these options. No new package, database migration, route, or platform key
is required. Keep the existing HTTPS reverse proxy and keeper configuration.

The keeper currently validates NIP-98 signatures, not the new relay account
sessions. Its authorization must be connected to credential-session validation
before rolling out hosted agents to the new username/password account flow.
Those accounts sign requests with an in-memory identity and include an
`account-session` tag, but the current keeper does not check that session's
validity or revocation.

The keeper supplies channel text replies; this change adds no shell, hardware,
or tool execution. The separate Rust `buzz-agent` runtime already supports
OpenRouter through `BUZZ_AGENT_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, and
`OPENROUTER_MODEL`.

## Verification

`web/tests/e2e/cloud-agents.spec.ts` exercises create/retry errors, provider-key
isolation, signed requests, legacy servers, and desktop/mobile layouts with
mocked services. `glass-hive/cmd/agentkeeper/openrouter_test.go` checks provider
requests, response parsing, errors, redirects, encrypted keys, and model policy.
The existing Rust OpenRouter tests also pass. No paid generation was performed;
a deployed end-to-end reply with a real key remains to be verified.

Protocol references: [OpenRouter quickstart](https://openrouter.ai/docs/quickstart),
[model catalog](https://openrouter.ai/api/v1/models), and
[reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).
