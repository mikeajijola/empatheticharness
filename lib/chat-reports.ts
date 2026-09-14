import { evidenceFromTrace, type TraceEvent } from '../agent/lib/evidence';
import { evaluateRun, evidenceOnlyReport, type EvaluationReport, type EvidenceRun } from './evaluation';
import { renderReportPdf } from './report-pdf';
import { readJson, writeJson, type ReportStore } from './report-store';

export type SavedRun = {
  sessionId: string; task: string; startedAt: string; updatedAt: string;
  status: 'running' | 'paused' | 'reporting' | 'ready' | 'report_failed';
  activity: string; actionCount: number; observationCount: number;
  outcome?: boolean | null; rationale?: string;
  reportKind?: 'evaluated' | 'evidence-only'; stopReason?: string;
  finishedAt?: string;
  model?: string;
  pendingRequestId?: string; continuationNote?: string; continuationCount?: number;
};
const relevant = new Set(['session.started', 'input.requested', 'input.resolved', 'message.received', 'actions.requested', 'action.result', 'message.completed', 'result.completed', 'turn.failed', 'turn.cancelled', 'session.failed', 'session.waiting', 'session.completed']);
export const manifestKey = (id: string) => `runs/${id}/manifest.json`;
export async function initializeChatRun(store: ReportStore, sessionId: string, task: string, startedAt = new Date().toISOString(), model?: string) {
  await store.create(manifestKey(sessionId), JSON.stringify({
    sessionId, task, startedAt, updatedAt: startedAt, status: 'running', ...(model ? { model } : {}),
    activity: 'Starting the simulation', actionCount: 0, observationCount: 0,
  } satisfies SavedRun));
}
export async function savedRuns(store: ReportStore): Promise<SavedRun[]> {
  const keys = (await store.keys('runs/')).filter(key => key.endsWith('/manifest.json'));
  const runs: SavedRun[] = [];
  for (const key of keys) { const run = await readJson<SavedRun>(store, key); if (run) runs.push(run); }
  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Keep evidence outside session retention, before generating the final report. */
export async function retainChatEvent(store: ReportStore, sessionId: string, event: TraceEvent, model?: string): Promise<void> {
  if (!relevant.has(event.type)) return;
  await writeJson(store, `runs/${sessionId}/events/${event.meta.id}.json`, event);
  if (event.type === 'message.received') {
    await initializeChatRun(store, sessionId, String(event.data?.message ?? ''), event.meta.at, model);
  }
  if (event.type === 'input.requested' && Array.isArray(event.data?.requests)) {
    const request = (event.data.requests as { kind?: string; requestId: string }[]).find(r => r.kind === 'session-limit');
    const run = await readJson<SavedRun>(store, manifestKey(sessionId));
    if (request && run) {
      const keys = await store.keys(`runs/${sessionId}/events/`);
      const history: TraceEvent[] = [];
      for (const key of keys) { const e = await readJson<TraceEvent>(store, key); if (e) history.push(e); }
      history.sort((a,b) => a.meta.at.localeCompare(b.meta.at));
      const last = history.filter(e => e.type === 'message.completed').at(-1);
      const note = `Token budget reached; the simulation is unfinished. Original aim: ${run.task}
Last agent observation (verify against a new screenshot): ${String(last?.data?.message ?? 'No written observation yet.')}
Continue by taking a fresh screenshot before acting. Preserve the original task and verify its final state. Browser retained for up to 30 minutes from start.`;
      await store.write(`runs/${sessionId}/continuation.txt`, note);
      await store.write(`runs/${sessionId}/continuations/${event.meta.id}.txt`, note);
      await writeJson(store, manifestKey(sessionId), { ...run, status: 'paused', pendingRequestId: request.requestId, continuationNote: note, activity: 'Token budget reached. Progress saved; ready to continue.', updatedAt: event.meta.at });
    }
  }
  if (event.type === 'input.resolved' && Array.isArray(event.data?.resolutions)) {
    const run = await readJson<SavedRun>(store, manifestKey(sessionId));
    if (run?.pendingRequestId && (event.data.resolutions as {requestId:string}[]).some(r => r.requestId === run.pendingRequestId))
      await writeJson(store, manifestKey(sessionId), { ...run, status: 'running', pendingRequestId: undefined, continuationCount: (run.continuationCount ?? 0) + 1, activity: 'Continuing the simulation from saved progress', updatedAt: event.meta.at });
  }
  if (['turn.cancelled', 'turn.failed', 'session.failed'].includes(event.type)) {
    const run = await readJson<SavedRun>(store, manifestKey(sessionId));
    if (run?.status === 'paused') await writeJson(store, manifestKey(sessionId), {
      ...run, status: 'running', pendingRequestId: undefined, updatedAt: event.meta.at,
    });
  }
  if (event.type === 'action.result') {
    const run = await readJson<SavedRun>(store, manifestKey(sessionId));
    const result = event.data?.result as { toolName?: string; isError?: boolean } | undefined;
    if (run?.status === 'running' && result?.toolName && event.meta.at > run.updatedAt) await writeJson(store, manifestKey(sessionId), {
      ...run, updatedAt: event.meta.at,
      activity: result.isError ? 'An interaction failed; the simulator is assessing it' : result.toolName === 'screen' ? 'Reviewing the app screen' : 'Interacting with the app',
      actionCount: run.actionCount + (['mouse', 'keyboard'].includes(result.toolName) ? 1 : 0),
      observationCount: run.observationCount + (result.toolName === 'screen' && !result.isError ? 1 : 0),
    });
  }
}
export type ReportDependencies = {
  evaluate: (run: EvidenceRun) => Promise<EvaluationReport>;
  render: typeof renderReportPdf;
};
const defaults: ReportDependencies = {
  evaluate: run => evaluateRun(run, { model: process.env.EVALUATOR_MODEL || 'openai/gpt-4.1-mini', abortSignal: AbortSignal.timeout(30_000), retryRateLimits: false }),
  render: renderReportPdf,
};
// Within a process, repeated terminal events and retries share the same generation.
const pending = new Map<string, Promise<void>>();
export function finishChatReport(store: ReportStore, sessionId: string, dependencies = defaults, retryAnalysis = false): Promise<void> {
  const current = pending.get(sessionId);
  if (current) return current;
  const work = generate(store, sessionId, dependencies, retryAnalysis).finally(() => pending.delete(sessionId));
  pending.set(sessionId, work);
  return work;
}
async function generate(store: ReportStore, sessionId: string, dependencies: ReportDependencies, retryAnalysis: boolean) {
  const manifest = await readJson<SavedRun>(store, manifestKey(sessionId));
  if (!manifest || manifest.status === 'paused' || (manifest.status === 'ready' && !(retryAnalysis && manifest.reportKind === 'evidence-only'))) return;
  const events: TraceEvent[] = [];
  for (const key of await store.keys(`runs/${sessionId}/events/`)) {
    const event = await readJson<TraceEvent>(store, key); if (event) events.push(event);
  }
  events.sort((a, b) => a.meta.at.localeCompare(b.meta.at) || a.meta.id.localeCompare(b.meta.id));
  if (!events.some(event => ['session.waiting', 'session.completed', 'session.failed'].includes(event.type))) throw new Error('The simulation is still running');
  const update = (changes: Partial<SavedRun>) => writeJson(store, manifestKey(sessionId), { ...manifest, ...changes, updatedAt: new Date().toISOString() });
  const evidence = { ...evidenceFromTrace(sessionId, events), ...(manifest.model ? { model: manifest.model } : {}) };
  const accessRestricted = evidence.terminal.observedState.includes('Free tier users do not have access to this model');
  const stopReason = accessRestricted ? 'AI Gateway denied model access with a free-tier restriction. Check the team’s Gateway access and billing settings.'
    : evidence.terminal.state === 'LIMIT_REACHED' ? 'The simulation reached its execution limit before it could finish.'
    : evidence.terminal.state === 'FAILED' ? 'The simulation stopped before it could finish.' : undefined;
  await update({ status: 'reporting', activity: 'Preparing your report from the saved evidence', stopReason, finishedAt: evidence.finishedAt });
  try {
    await writeJson(store, `runs/${sessionId}/evidence.json`, evidence);
    // Reuse a saved judgment if only PDF rendering or a previous response failed.
    let report = await readJson<EvaluationReport>(store, `runs/${sessionId}/evaluation.json`);
    if (!report || (retryAnalysis && report.kind === 'evidence-only')) {
      try { report = await dependencies.evaluate(evidence); }
      catch (error) {
        console.warn('chat-analysis-unavailable', { sessionId, error: error instanceof Error ? error.name : 'Error' });
        report = evidenceOnlyReport(evidence);
      }
    }
    await writeJson(store, `runs/${sessionId}/evaluation.json`, report);
    await store.write(`runs/${sessionId}/report.pdf`, await dependencies.render(evidence, report));
    await update({ status: 'ready', activity: 'Your PDF report is ready', reportKind: report.kind ?? 'evaluated', stopReason, finishedAt: evidence.finishedAt, outcome: report.judgment.verifiedSuccess, rationale: report.judgment.rationale,
      actionCount: report.metrics.actionCount, observationCount: report.metrics.observationCount });
  } catch (error) {
    await update({ status: 'report_failed', activity: 'Report generation failed. Your evidence is saved; retry to generate the PDF.' });
    console.error('chat-report-generation-failed', { sessionId, error: error instanceof Error ? error.name : 'Error' });
  }
}

/** Fatal workflow failures bypass session hooks. The originating channel receives them. */
export async function retainChatFailure(store: ReportStore, data: { sessionId: string; message?: string; code?: string }, dependencies = defaults) {
  if (!await readJson<SavedRun>(store, manifestKey(data.sessionId))) return;
  await retainChatEvent(store, data.sessionId, {
    type: 'session.failed', meta: { id: `failure-${data.sessionId}`, at: new Date().toISOString() }, data,
  });
  await finishChatReport(store, data.sessionId, dependencies);
}

const reconciling = new Map<string, Promise<void>>();
/** Repair missed terminal delivery from the durable trace, never infer failure from age. */
export function reconcileChatRun(store: ReportStore, sessionId: string, getStream: () => Promise<ReadableStream<TraceEvent>>, dependencies = defaults): Promise<void> {
  const current = reconciling.get(sessionId); if (current) return current;
  const work = reconcile(store, sessionId, getStream, dependencies).finally(() => reconciling.delete(sessionId));
  reconciling.set(sessionId, work); return work;
}
async function reconcile(store: ReportStore, sessionId: string, getStream: () => Promise<ReadableStream<TraceEvent>>, dependencies: ReportDependencies) {
  const run = await readJson<SavedRun>(store, manifestKey(sessionId));
  if (!run || run.status === 'ready' || run.status === 'paused') return;
  if (run.status === 'reporting' && Date.now() - Date.parse(run.updatedAt) < 90_000) return;
  const checkKey = `runs/${sessionId}/status-check.json`;
  const check = await readJson<{ at: number }>(store, checkKey);
  if (check && Date.now() - check.at < 30_000) return;
  // A check must never overwrite a concurrent progress or completed manifest.
  await writeJson(store, checkKey, { at: Date.now() });
  const reader = (await getStream()).getReader();
  const timeout = setTimeout(() => void reader.cancel(), 8_000);
  const events: TraceEvent[] = []; let bytes = 0; let terminal = false;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += JSON.stringify(value).length;
      if (bytes > 100_000_000) throw new Error('Trace exceeds export size limit');
      if (relevant.has(value.type)) events.push(value);
      if (['session.waiting', 'session.completed', 'session.failed'].includes(value.type)) terminal = true;
      if (['turn.started', 'step.started', 'message.received', 'input.resolved'].includes(value.type)) terminal = false;
    }
  } finally { clearTimeout(timeout); await reader.cancel(); }
  if (!terminal) return;
  // Event keys are idempotent. Do not replay progress counters into the manifest.
  for (const event of events) await writeJson(store, `runs/${sessionId}/events/${event.meta.id}.json`, event);
  await finishChatReport(store, sessionId, dependencies);
}
