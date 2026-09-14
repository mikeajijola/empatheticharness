# Run evidence

Generated JSON, PNG, PDF, and session traces are private runtime artifacts and are excluded from Git and deployment uploads. This public repository includes no retained live runs. Unit tests use synthetic fixtures; they do not establish live model performance.

Run the visual evaluations against your own deployment as described in [the eval guide](../docs/evals.md). Store exported runs under `evidence/runs/`; `scripts/demo.ts` exports traces and `npm run artifacts:archive` archives local evidence and reports to your configured private Blob store. Saved reports are available through the authenticated chat interface.
