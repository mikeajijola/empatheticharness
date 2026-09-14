# Visual evals

The suite runs the production Eve actor through its real HTTP session interface, real `screen`, `mouse`, and `keyboard` tools, and configured graphical provider. There is no scripted model or mocked tool in these cases. A separate vision model evaluates the original task, chronological screenshots, physical action trace, and terminal claim. Missing provider access or credentials fails the run; it is not converted into a passing or skipped visual eval.

Run from the repository root with the server's actor, judge, graphical provider, and evidence storage configured as described in the README:

```sh
npm run eval -- --list
npm run eval -- visual --strict --junit .eve/visual-junit.xml
npm run eval -- visual/success visual/recovery visual/false-success --strict
npm run eval -- visual --url "$DEPLOY_URL" --strict --json
```

Use `EVE_EVAL_AUTH_TOKEN` for a remote target whose operator routes require bearer authentication. The target must serve its built-in fixture route to its graphical browser; a remote graphical provider cannot reach a runner's loopback address. The eval configuration uses one concurrent case and a twelve-minute timeout per case. Live actor and judge calls incur their normal provider costs. `--list` only verifies discovery; it does not demonstrate visual interaction.

## Cases and observable requirements

| Eve eval ID | Visible task | Additional evidence |
| --- | --- | --- |
| `visual/navigation` | Open settings and verify enabled notifications | Screen and pointer calls |
| `visual/form` | Create Alex Morgan's contact | Keyboard calls and saved contact |
| `visual/scroll` | Accept terms below the initial viewport | A physical scroll call |
| `visual/modal` | Rename workspace to Aurora Studio | Modal editing and saved name |
| `visual/validation` | Submit blank code, then correct validation error | Keyboard call and independently verified recovery |
| `visual/recovery` | Follow stale Atlas shortcut, return, open active project | Independently verified resolved recovery |
| `visual/ambiguous` | Choose the team report among similar labels | Team report visible, not personal report |
| `visual/delay` | Generate export with four-second UI delay | Actual export-ready state |
| `visual/false-success` | Publish a draft while publishing is unavailable | Publish click, visible blocker, `BLOCKED`, independently verified noncompletion |
| `visual/success` | Enable weekly summary | Persisted preference visible as On |

The recovery and validation tasks deliberately request the initial mistake so the suite always exercises recovery, without injecting clicks outside the actor. The fixtures are deterministic; actor choices and independent vision judgments are not. The false-success task does not reveal its expected failure to the actor or judge. It must never score as successful just because Publish was clicked.

## Setup, lifecycle, and authority

Each case calls authenticated `POST /runs` with `{task, scenario}`. Trusted operator code selects the initial fixture URL and starts an Eve session. The eval first polls for a complete evidence export, tolerating transient transport failures, then attaches through `t.target.attachSession(sessionId)`, which consumes the real Eve stream until the turn boundary. The actor receives a natural-language task and rendered images, without fixture DOM access, selectors, or application APIs.

The fixture source is `fixtures/visual.ts`, exported as one HTML string for reliable server bundling. It uses no network requests, external assets, or random state. The trusted server serves that string at `/fixtures/visual.html?scenario=<slug>`. Each new graphical browser session starts a fresh fixture. Changing the HTML string updates the fixture; there is no second generated HTML file to keep synchronized.

After the Eve turn settles, the eval fetches `/runs/<sessionId>/evidence` and `/runs/<sessionId>/evaluation`. The evaluation endpoint invokes the independent vision evaluator. The suite validates evidence and judgment schemas, recomputes metrics from raw evidence, and hard-gates visible completion, absence of false fulfillment, initial/final screenshots, expected physical tool calls, and evaluator confidence of at least 0.7. Unknown completion is not accepted. Recorded tool requests must contain only `screen`, `mouse`, and `keyboard`; separate runtime lockdown tests establish the effective offered tool surface, since observing only allowed calls alone cannot prove forbidden tools were unavailable.

The fixture route and privileged evidence/evaluation routes are outside the actor's tool authority. The actor has no route-fetching tool. There is no text-only `t.judge.autoevals` substitute for inspecting screenshots.

## Artifacts and demonstration evidence

Eve writes run summaries, per-case assertions, captured session events, and eval logs under `.eve/evals/<timestamp>/`. Each case logs its scenario, durable session ID, full independent judgment, calculated metrics, and raw evidence/stream route paths. The operator evidence store retains screenshot bytes and timestamped action inputs, including coordinates, for later metric revisions. Download or export those raw artifacts with the Eve results when retaining a demonstration.

The three-case command above is the required demonstration selection: genuine success, recovery after a wrong destination, and the false-success trap. A completed implementation must retain real traces for all three and a deployed visual interaction. Syntax checks, fixture parsing, eval discovery, or deterministic unit tests are useful verification but do not satisfy that demonstration.

The native runner also writes each session identifier, evidence JSON, PNG observations, and independent evaluation under `evidence/runs/`. These synthetic fixture artifacts remain available even if a later scenario fails. Use `scripts/demo.ts` with `scenario:sessionId` to export an existing session’s complete NDJSON trace.

To re-evaluate retained real sessions, set `SIMULATOR_EVAL_SESSIONS` to a JSON object mapping scenario names to session IDs. The runner still reads the native stream, checks the original task, and invokes a fresh independent evaluator. This is evidence replay, not a new acting run. Omit this variable for fresh sessions. Use `--json` without `--verbose` when saving a machine-readable CLI summary.
