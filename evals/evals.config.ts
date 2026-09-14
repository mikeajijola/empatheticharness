import { defineEvalConfig } from 'eve/evals';

// These are real browser/model runs. Keep browser capacity and judge cost bounded.
export default defineEvalConfig({ maxConcurrency: 1, timeoutMs: 720_000 });
