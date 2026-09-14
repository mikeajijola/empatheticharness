# Independent visual evaluation

`lib/evaluation.ts` evaluates recorded runs in a fresh AI SDK generation with a separately configured vision model. The simulator cannot call the evaluator as a tool or provide its own grade. The evaluator gets the task, chronological physical actions and tool outcomes, each screenshot as an actual image part, and the terminal state explicitly labeled as a claim. It has no app-control tools. `evaluateRun(run, { model })` returns a validated judgment and deterministic metrics; model or validation failures propagate and must be recorded as evaluation errors, never converted into successful runs.

`EvidenceRun` and `evidenceRunSchema` define the recording contract. Events have unique IDs, ISO UTC timestamps, a `screen`, `mouse`, or `keyboard` kind, input and optional result/error. Screenshot observations include base64 bytes, MIME type and viewport dimensions. Events must be chronological and within the run interval. The caller must persist the evidence and resulting report with the session so reviewers can inspect cited screenshots.

Completion is `true`, `false`, or `null` (insufficient visual evidence). Every non-null completion decision requires a screenshot citation. Verified success must cite the final successful screenshot, and that screenshot must follow the final physical action, including failed actions that might have side effects. Stale screenshots and failed captures cannot establish success. The evaluator is instructed to verify every task condition in the final visible state and distrust optimistic toasts and terminal SUCCESS claims. False fulfillment means the simulator claimed SUCCESS but the independent evaluator found non-completion; a SUCCESS claim with an unknown outcome has unknown false fulfillment. A non-SUCCESS terminal claim has no false fulfillment, irrespective of task outcome. Confidence is a model's subjective assessment, not a calibrated probability.

Metrics are computed only from the supplied real trace and validated judgment:

| Metric | Definition |
| --- | --- |
| Action count | Mouse and keyboard events, including failed attempts |
| Observation count | Events containing screenshot observations |
| Total interactions | All physical tool events, including screen calls |
| Completion latency | Recorded finish minus start, including incomplete runs; not time to verified success |
| Repeated actions | Each identical consecutive action after the first, ignoring intervening observations and object key order |
| Repeated loops | Number of runs of consecutive identical actions; a conservative repetition proxy, not semantic multi-action loop detection |
| Recovery count | Evaluator-cited attempts following an obstacle/error |
| Successful recovery count | Attempts with a subsequent screenshot cited as resolution |
| Backtracking count | Unique action IDs judged unnecessary returns to prior steps |
| Blocked | Simulator terminal state equals BLOCKED; this is reported behavior, not independent blocker verification |
| Visible blockers / UX friction | Independent descriptions with event references |

`aggregateEvaluations` rejects duplicate sessions. Success and false-fulfillment rates exclude unknown judgments and expose their evaluated denominators. Blocked rate uses all supplied runs. Empty populations and unknown-only outcome populations return null rates. Nothing creates synthetic run results or infers an efficiency score without a reference path. Report coverage alongside rates; omitting failed evaluations could bias a benchmark.

Unit tests exercise false-success adjudication, unknown outcomes, screenshot message construction, duplicate/invented evidence rejection, recovery ordering, and repetition counts using explicitly synthetic data and supplied fixture judgments. They do not validate a live vision model or constitute measured benchmark runs. Run live scenario evaluations separately with real screenshots and a configured independent evaluator model.
