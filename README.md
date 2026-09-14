# Empathetic Harness

An Eve-native agent that operates a graphical application through **screen**, **mouse**, and **keyboard**. Eve 0.52.2 owns the reasoning loop, sessions, durable state, tool execution, and traces. A separate vision-model invocation evaluates completion from the original task and screenshot history.

## Run

Requires Node.js 24+, a Vercel account with Sandbox and AI Gateway access, and a vision-capable Gateway model.

```sh
npm ci
npx eve link --project empatheticharness --non-interactive
# Set SIMULATOR_PASSWORD and COMPUTER_INITIAL_URL in .env.local.
npm run dev
```

The operator starts a fresh session with `POST /runs` and `{ "task": "Enable weekly summaries and verify the saved setting" }`. `COMPUTER_INITIAL_URL` is trusted runtime setup; the model cannot call a navigation API. For the bundled test application, supply a `scenario` instead, e.g. `{ "task": "Enable the weekly summary and verify that the saved preference is On.", "scenario": "success" }`.

Production routes require `Authorization: Bearer <SIMULATOR_PASSWORD>` or HTTP Basic user `operator` with that password. This is a single-operator service; all authorized operators can read its sessions. The static test fixture is public and contains synthetic data only. With no configured password, production agent routes reject callers. Local Eve development uses Eve's local-development authenticator.

`POST /runs` returns `{sessionId}` immediately. Read `/runs/:sessionId/stream` for live NDJSON, `/runs/:sessionId/evidence` after completion, and `/runs/:sessionId/evaluation` to invoke the independent judge. Evidence exports may return 409 while the turn is active. Download evidence to retain it beyond the managed session retention period.

## Browser chat and saved reports

Open the app (the home page redirects to `/chat`) and sign in with `SIMULATOR_PASSWORD`. Choose **Claude Sonnet 5**, **GPT-5.6 Sol**, or **Gemini 3.8 Flash**, then paste a task (up to 12,000 characters), supply an app URL or choose a test scenario, and select **Send task & create report**. Each message starts an independent Eve session. The current acting limit is 10 minutes; closing the tab does not cancel the session. If progress pauses, the chat shows when activity was last recorded and offers **Stop & save report**. Fatal workflow failures generate a report through the channel failure handler; opening chat also reconciles unfinished entries against the durable event stream. The evaluator has a 30-second deadline and does not wait through rate-limit retries: when analysis is unavailable, the saved PDF contains an explicitly labelled evidence-only report with screenshots and no completion verdict. **Retry AI analysis** can upgrade it later. These changes preserve output under throttling; completing longer investigations still requires sufficient AI Gateway capacity.


The conversation shows progress and eventually a **Download PDF** button. Saved conversations come from server storage, so they remain available after a browser refresh or restart. The report includes unsuccessful and unverified outcomes. If evaluation or PDF generation fails, retained evidence remains available and **Retry PDF generation** retries the report. Chat uses `EVALUATOR_MODEL` when configured, or `openai/gpt-4.1-mini` by default, in a separate evaluation invocation. A saved evaluation is reused when only rendering failed. A reporting job interrupted for more than four minutes can also be retried from the conversation.

The browser surface uses Eve’s custom HTTP channel support. Chat SDK is suited to a future Telegram/Slack adapter; it is not required for this browser UI. The simulator still exposes exactly the three physical tools to its acting model.

Storage:

- Local/self-hosted: files live in `.reports/`, or `REPORTS_DIRECTORY`. Keep this directory on persistent disk.
- Vercel: connect a **private** Blob store and configure `BLOB_READ_WRITE_TOKEN` (or `BLOB_STORE_ID` with project OIDC). The app refuses to start chat runs on Vercel without durable report storage. Downloads go through the authenticated app; private Blob URLs are not exposed.
- There is no automatic report expiry. Session retention does not delete archived report files. The existing single-operator access policy applies to all saved conversations.

To add a previously exported run to the chat history without another model call:

```sh
npm run report:import -- evidence/runs/success-SESSION_ID
```

Endpoints: `GET /chat` serves the page; authenticated `POST /chat/messages` accepts a task and returns a session ID immediately; `GET /chat/runs` lists saved conversations; `GET /chat/runs/:sessionId/report.pdf` downloads a finished report; `POST /chat/runs/:sessionId/report` retries report generation. An agent hook archives the relevant events and produces the evaluation and PDF when the session reaches a terminal/waiting state. Report processing is idempotent once a complete report exists; the evaluator remains a separate model call.

## PDF reports

Generated artifacts are ignored by Git and excluded from deployment uploads. `npm run artifacts:archive` uploads existing `evidence/` artifacts and `.reports/runs/` reports to the configured private Blob store. It preserves local files and writes a SHA-256 inventory at `simulator-reports/archive/index.json`. Load your Blob environment before running the command, for example `node --env-file=.env.local --import tsx scripts/archive-artifacts.ts`.

The demo export automatically saves a human-readable `report.pdf` alongside each run’s JSON evidence and screenshots in `evidence/runs/<scenario>-<sessionId>/`. Open that file in a PDF viewer.

To generate a PDF from an already exported run, without making another model call:

```sh
npm run report -- evidence/runs/success-SESSION_ID
```

Optionally supply an output filename as the second argument. Both `evidence.json` and `evaluation.json` must exist in the run directory. The report includes the task, verified outcome, evaluator explanation, simulator observation, metrics, blockers, usability friction, recovery references, and initial, final, and evaluator-referenced screenshots. Reports reflect the saved evaluation, including incomplete or unverified outcomes.

## Authority and evidence

- `defaultTools: false`; no skills, connections, schedules, or subagents. A model middleware verifies the actual request contains exactly the three named function tools, failing closed on any additional capability.
- `screen({})` delivers a viewport PNG and its pixel dimensions to the acting model via Eve multimodal tool output. No DOM, accessibility tree, OCR, network inspection, or semantic browser automation is exposed.
- A provider-neutral `Computer` contract hides Chromium in a named Vercel Sandbox. The trusted broker accepts only physical input and screenshot operations over a private Unix socket.
- The broker serializes calls, requires a screenshot before the next action, deduplicates physical call IDs, bounds coordinates and inputs, and stops ambiguous replays. A dead browser fails closed instead of silently restarting application state.
- Actor JSON states are `SUCCESS`, `BLOCKED`, `FAILED`, and `LIMIT_REACHED`. Success is an untrusted claim until a separate evaluator checks fresh final visual evidence. The evaluator has no tools and no access to the acting agent's model context.
- Eve's durable event stream retains screenshots, tool inputs/results/errors, timestamps, observed-state descriptions, and session identifiers. Raw events are retained during demo export alongside PNGs and evaluation results. Each independent evaluation is a new model invocation and may vary.

See [provider and replay semantics](docs/provider.md), [evaluation and metric definitions](docs/evaluation.md).

## Verification

```sh
npm run typecheck
npm test
npx eve info --json
npx eve eval --list
npm run build
```

The ten real visual scenarios run through Eve's native eval runner:

```sh
# EVE_EVAL_AUTH_TOKEN must equal the deployed SIMULATOR_PASSWORD.
npx eve eval --url https://YOUR-DEPLOYMENT --strict --max-concurrency 1 --verbose
# Export the three required real traces, PNGs and independent evaluations:
node --env-file=.env.local --import tsx scripts/demo.ts https://YOUR-DEPLOYMENT
```

See [eval scenario coverage](docs/evals.md). Unit tests use explicitly labeled deterministic fixtures and do not constitute visual model demonstrations.

## Deploy

Set `SIMULATOR_PASSWORD` in Vercel production environment variables, then use Eve's standard deployment path:

```sh
npx eve deploy --project empatheticharness --non-interactive --yes
```

Gateway and Sandbox use project OIDC on Vercel. The first observation provisions a browser and installs its graphical dependencies; subsequent tools reconnect to the same running named sandbox. Each session has a 30-minute maximum browser lifetime (released when its turn ends), 10-minute acting deadline, 100 model-step cap, and a configurable `COMPUTER_MAX_ACTIONS` limit (default 100). The terminal model response should acknowledge an action limit; the step/deadline guard enforces termination independently.

The actor limits each model response to 4,096 tokens. Model rate-limit retries are bounded and cancellation-aware; evaluator calls use a separate bounded retry path. Free-tier Gateway access can still prevent live acceptance runs from completing.

Eve emits native Workflow run tags and tool traces. Use `vercel agent-runs --help` to discover the current observability CLI; Agent Runs visibility depends on team enablement. The authenticated session-stream endpoint remains the application's trace export path.

## Runtime behavior

The chat API accepts an allowlisted `model` field. The selection is fixed in the run’s initial authorization attributes and recorded in its saved report. All three models use the same screenshot/mouse/keyboard boundary, low reasoning effort, 4,096-token per-step ceiling and existing session limits. The evaluator remains independently configured through `EVALUATOR_MODEL`.

Simulation progress spans token-budget turns: pauses save a continuation note in private storage, preserve the live browser, and automatically grant up to three fresh token budgets. A Continue simulation button retries a deferred continuation. The browser must still be live (28-minute continuation window, 30-minute sandbox lifetime); expired browsers require a new simulation and a fresh login. Stop & save report ends a paused simulation without claiming completion. Actor screenshots are 1024×640; model calls retain the five newest screenshot payloads plus all action/text history, while reports retain every screenshot.

## Interface

The UI uses self-hosted Geist Sans and Geist Mono 1.7.2, semantic neutral colors, 6px control/surface radii, and 12px sign-in surfaces. Light/dark colors follow the device preference; reduced-motion and visible keyboard-focus states are supported. Saved simulations scroll within the desktop sidebar and become a horizontal list on mobile. Font licenses are in `assets/Geist-LICENSE.txt`; font data is bundled in `ui/geist-fonts.ts` to work with Eve's server output. Base design tokens live in `ui/geist.ts`. Reference: https://vercel.com/geist.

The header Light mode / Dark mode switch overrides the system theme and remembers the choice in this browser.

## Public source and private data

This repository contains application source and synthetic test fixtures. Deployment credentials, saved reports, screenshots, transcripts, and prior trial artifacts are not included. Configure a new Vercel project and private Blob store for your installation. Keep `.env.local`, `.eve/`, `.reports/`, and generated `evidence/` out of Git. The generic `simulator-reports/` storage prefix and `SIMULATOR_*` environment variables remain stable.
