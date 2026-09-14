# Computer provider

`getComputer(sessionId, { callId, initialUrl })` supplies the seven physical input
operations and PNG screenshots. Only trusted application code supplies the session
ID, framework tool call ID, and optional initial URL. The model receives none of
the provider's provisioning, command, filesystem, HTTP, or browser handles.

The Vercel provider uses `@vercel/sandbox` 3.2.1. Install this as an application
dependency. It installs pinned Playwright 1.63.0 and Chromium inside a node24
sandbox; no local browser dependency is needed. Bootstrap installs Chromium's
Amazon Linux system libraries with dnf. First use therefore takes longer than
subsequent tool calls and requires network access to npm and the browser CDN.

Configure `COMPUTER_INITIAL_URL` to an HTTP(S) test website. Optionally set
`COMPUTER_MAX_ACTIONS` (1–1000; default 100). Vercel deployments use SDK OIDC
authentication; local hosts can supply `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and
`VERCEL_PROJECT_ID`. Credentials remain in the trusted host, never in Chromium.
SDK authentication: https://vercel.com/docs/sandbox/concepts/authentication

The deterministic sandbox name hashes the Eve session ID. Eve `defineState`
durably records the binding, and `Sandbox.get({ name, resume: false })` reconnects
on later steps, turns, or host processes. It is not an in-memory computer map.
The initial creation uses `getOrCreate` to recover provisioning retries before
the binding checkpoint. Each session performs one simulation task. The native
`computer-cleanup` hook stops its VM after `turn.completed` or `turn.failed`,
once the event has been durably recorded. This preserves screenshot/action
evidence in the Eve stream while releasing browser compute. Cleanup looks up
the existing named sandbox with resume disabled; it never creates a computer.
Failures are best effort and log only a fixed operator status. A subsequent
task needs a new Eve session.

The 30-minute VM timeout is a fallback if cleanup cannot run; stopped VMs and dead
browser processes fail closed, requiring a new Eve session. Browser process state
is not restored from filesystem snapshots. SDK lifecycle reference:
https://vercel.com/docs/sandbox/sdk-reference

A persistent Chromium process renders a 1024×640 viewport. The only navigation
API is the initial operator-configured `goto`; subsequent operations use mouse,
keyboard, and viewport screenshots. This is a browser viewport, not a full
desktop: there is no browser address bar, OS window control, or accessibility
tree. Popups become the active page. A closed active page fails closed.

The broker listens on a Unix socket inside the VM, with no exposed TCP port.
Target web pages cannot call the broker over HTTP. The trusted host sends only
fixed operation names and JSON arguments through `sandbox.runCommand`; typed
text never becomes executable shell or JavaScript. Responses contain rendered
PNG data or fixed physical-operation statuses, never DOM, selectors, page text,
network responses, or raw Playwright errors.

The broker serializes requests, bounds inputs and action count, and requires a
screenshot before every new physical action. Tools should capture another
screenshot after each action. Physical retries carrying the same `callId` and
operation replay the prior result without repeating input; changing arguments
under the same ID is rejected. An uncertain or partially failed action poisons
the broker instead of retrying. These receipts live with the browser process:
if it dies, interaction fails closed. Screenshots are safely repeatable.

The action budget reports `LIMIT_REACHED`. Setup failures log fixed stage names
and failed status for the operator; raw SDK errors, page URLs, and browser output
are never returned to the acting model. An SDK auto-resume race stops the resumed
VM and fails closed. Chromium's own process sandbox is explicitly disabled (the
Playwright default); isolation comes from the dedicated Vercel microVM.

`tests/provider.test.ts` exercises the real broker source against a fake physical
device, including replay, screenshot gating, allowed operations, bounds, action
budget, and modifier release. A live VM smoke test additionally needs working
Vercel credentials and should screenshot, click/type, screenshot, reconnect by
session, and verify the visible state remains. Unit tests do not prove Chromium
bootstrap or cloud connectivity.
