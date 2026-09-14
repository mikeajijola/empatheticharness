import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileReportStore, readJson, reportStore } from '../lib/report-store';
import { finishChatReport, retainChatEvent, retainChatFailure, reconcileChatRun, initializeChatRun, savedRuns, manifestKey, type SavedRun } from '../lib/chat-reports';
import { evidenceFromTrace, type TraceEvent } from '../agent/lib/evidence';
import { deriveMetrics, type EvaluationReport, type EvaluationJudgment } from '../lib/evaluation';
import { renderReportPdf } from '../lib/report-pdf';
import chat from '../agent/channels/chat';
import type { RouteHandlerArgs } from 'eve/channels';

const sessionId = 'fixture-chat-success';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2VQAAAAASUVORK5CYII=';
const event = (id: string, type: string, second: number, data: Record<string, unknown>): TraceEvent => ({
  type, meta: { id, at: `2026-09-09T00:00:0${second}.000Z` }, data,
});
// Deterministic synthetic evidence, independent of generated live-run artifacts.
const events: TraceEvent[] = [
  event('e1', 'message.received', 0, { message: 'Fixture: enable weekly summaries' }),
  event('e2', 'action.result', 1, { result: { callId: 's1', toolName: 'screen', output: { base64: png, width: 1, height: 1 } } }),
  event('e3', 'actions.requested', 2, { actions: [{ callId: 'm1', input: { action: 'click', x: 0, y: 0 } }] }),
  event('e4', 'action.result', 3, { result: { callId: 'm1', toolName: 'mouse', output: {} } }),
  event('e5', 'action.result', 4, { result: { callId: 's2', toolName: 'screen', output: { base64: png, width: 1, height: 1 } } }),
  event('e6', 'result.completed', 5, { result: { state: 'SUCCESS', observedState: 'Fixture saved' } }),
  event('e7', 'session.waiting', 6, {}),
];
async function seed(directory: string) {
  const store = fileReportStore(directory);
  for (const event of events) await retainChatEvent(store, sessionId, event);
  return store;
}
async function report(): Promise<EvaluationReport> {
  const judgment: EvaluationJudgment = { verifiedSuccess: true, confidence: 1, evidenceEventIds: ['e5'], rationale: 'Deterministic fixture judgment; not a live visual evaluation.', visibleBlockers: [], uxFriction: [], recoveries: [], backtrackingEventIds: [] };
  return { sessionId, judgment, metrics: deriveMetrics(evidenceFromTrace(sessionId, events), judgment) };
}

test('saved reports survive a new storage instance and terminal replays reuse the judgment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chat-report-'));
  try {
    const store = await seed(directory); let calls = 0;
    const dependencies = { evaluate: async () => { calls++; return report(); }, render: renderReportPdf };
    await Promise.all([finishChatReport(store, sessionId, dependencies), finishChatReport(store, sessionId, dependencies)]);
    const reopened = fileReportStore(directory);
    assert.equal((await savedRuns(reopened))[0].status, 'ready');
    const pdf = await reopened.read(`runs/${sessionId}/report.pdf`);
    assert.equal(pdf?.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf!.length > 10_000, 'includes embedded fonts and synthetic screenshot evidence');
    await finishChatReport(reopened, sessionId, dependencies);
    assert.equal(calls, 1);
    assert.ok(await reopened.read(`runs/${sessionId}/evidence.json`));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('PDF failure retains the evaluation and retry does not call the model again', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chat-retry-'));
  try {
    const store = await seed(directory); let calls = 0;
    await finishChatReport(store, sessionId, { evaluate: async () => { calls++; return report(); }, render: async () => { throw new Error('fixture rendering failure'); } });
    assert.equal((await readJson<SavedRun>(store, manifestKey(sessionId)))?.status, 'report_failed');
    await finishChatReport(fileReportStore(directory), sessionId, { evaluate: async () => { throw new Error('must reuse judgment'); }, render: renderReportPdf });
    assert.equal((await savedRuns(store))[0].status, 'ready'); assert.equal(calls, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('running tasks cannot be prematurely reported and path traversal is rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chat-running-'));
  try {
    const store = fileReportStore(directory);
    await retainChatEvent(store, 'test', { type: 'message.received', meta: { id: 'evt_1', at: '2026-09-09T00:00:00.000Z' }, data: { message: 'Still running' } });
    await assert.rejects(finishChatReport(store, 'test'), /still running/);
    await assert.rejects(store.read('../secret'), /Invalid storage key/);
    await assert.rejects(store.write('/absolute', 'bad'), /Invalid storage key/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('fatal channel failure saves a PDF even when the evaluator is rate limited', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chat-fatal-'));
  try {
    const store = fileReportStore(directory);
    for (const e of events.slice(0, 5)) await retainChatEvent(store, sessionId, e);
    await retainChatFailure(store, { sessionId, message: 'FatalError: LIMIT_REACHED' }, {
      evaluate: async () => { throw Object.assign(new Error('Rate limited'), { statusCode: 429 }); }, render: renderReportPdf,
    });
    const run = (await savedRuns(store))[0];
    assert.equal(run.status, 'ready'); assert.equal(run.reportKind, 'evidence-only');
    assert.equal(run.outcome, null); assert.match(run.stopReason!, /execution limit/);
    assert.equal((await store.read(`runs/${sessionId}/report.pdf`))?.subarray(0, 5).toString(), '%PDF-');
    const evaluation = await readJson<EvaluationReport>(store, `runs/${sessionId}/evaluation.json`);
    assert.equal(evaluation!.judgment.confidence, 0);
    assert.equal(evaluation!.judgment.evidenceEventIds.length, 2);
    // Replayed progress must not turn a finished report back into a running job.
    await retainChatEvent(store, sessionId, events[3]);
    assert.equal((await savedRuns(store))[0].status, 'ready');
    await initializeChatRun(store, sessionId, 'Late initialization');
    assert.equal((await savedRuns(store))[0].status, 'ready');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('durable trace reconciliation repairs a missed failure without double-counting actions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chat-reconcile-'));
  try {
    const store = fileReportStore(directory);
    const trace = [...events.slice(0, 5), event('fatal', 'session.failed', 6, { message: 'LIMIT_REACHED' })];
    for (const e of trace.slice(0, -1)) await retainChatEvent(store, sessionId, e);
    const getStream = async () => new ReadableStream<TraceEvent>({ start(c) { trace.forEach(e => c.enqueue(e)); c.close(); } });
    await reconcileChatRun(store, sessionId, getStream, { evaluate: async () => { throw new Error('Offline'); }, render: renderReportPdf });
    const run = (await savedRuns(store))[0];
    assert.equal(run.status, 'ready'); assert.equal(run.actionCount, 1); assert.equal(run.observationCount, 2);
    assert.equal(run.finishedAt, trace.at(-1)!.meta.at);
    assert.match(run.stopReason!, /execution limit/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('age alone does not turn a live stream into a failed or completed run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chat-active-'));
  try {
    const store = fileReportStore(directory);
    await retainChatEvent(store, sessionId, events[0]);
    await reconcileChatRun(store, sessionId, async () => new ReadableStream({ start(c) { c.enqueue(events[0]); c.close(); } }), {
      evaluate: async () => { throw new Error('Must not evaluate active run'); }, render: renderReportPdf,
    });
    const run = (await savedRuns(store))[0];
    assert.equal(run.status, 'running'); assert.equal(run.updatedAt, events[0].meta.at);
    assert.equal(await store.read(`runs/${sessionId}/report.pdf`), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an evidence-only PDF can be upgraded by explicitly retrying AI analysis', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chat-upgrade-'));
  try {
    const store = await seed(directory);
    await finishChatReport(store, sessionId, { evaluate: async () => { throw new Error('Offline'); }, render: renderReportPdf });
    assert.equal((await savedRuns(store))[0].reportKind, 'evidence-only');
    await finishChatReport(store, sessionId, { evaluate: report, render: renderReportPdf }, true);
    assert.equal((await savedRuns(store))[0].reportKind, 'evaluated');
    assert.equal((await savedRuns(store))[0].outcome, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function route(path: string, method: string) {
  const found = chat.routes.find(route => route.path === path && route.method === method);
  if (!found || found.transport === 'websocket') throw new Error('Missing route');
  return found.handler;
}
test('chat endpoints enforce auth, validate task URLs, and serve persisted PDF downloads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chat-routes-'));
  const original = { password: process.env.SIMULATOR_PASSWORD, directory: process.env.REPORTS_DIRECTORY, token: process.env.BLOB_READ_WRITE_TOKEN, store: process.env.BLOB_STORE_ID, vercel: process.env.VERCEL };
  process.env.SIMULATOR_PASSWORD = 'fixture-password'; process.env.REPORTS_DIRECTORY = directory;
  delete process.env.BLOB_READ_WRITE_TOKEN; delete process.env.BLOB_STORE_ID; delete process.env.VERCEL;
  try {
    const args = { params: { sessionId } } as unknown as RouteHandlerArgs;
    const unauthorized = await route('/chat/runs', 'GET')(new Request('http://localhost/chat/runs'), args);
    assert.equal(unauthorized.status, 401);
    const headers = { authorization: 'Bearer fixture-password', 'content-type': 'application/json' };
    for (const body of [{ task: 'Test', initialUrl: 'javascript:alert(1)' }, { task: ' ' }, { task: 'x'.repeat(12001) }, { task: 'Test', model: 'unapproved/model' }]) {
      assert.equal((await route('/chat/messages', 'POST')(new Request('http://localhost/chat/messages', { method: 'POST', headers, body: JSON.stringify(body) }), args)).status, 400);
    }
    const crossOrigin = await route('/chat/messages', 'POST')(new Request('http://localhost/chat/messages', { method: 'POST', headers: { ...headers, origin: 'https://other.example' }, body: JSON.stringify({ task: 'test' }) }), args);
    assert.equal(crossOrigin.status, 403);
    let input: unknown;
    const dispatch = { from: () => ({ send: async (task: string, options: unknown) => { input = { task, options }; return { id: sessionId }; } }) } as unknown as RouteHandlerArgs;
    const accepted = await route('/chat/messages', 'POST')(new Request('http://localhost/chat/messages', { method: 'POST', headers, body: JSON.stringify({ task: 'Test the save button', initialUrl: 'https://app.example' }) }), dispatch);
    assert.equal(accepted.status, 202);
    assert.equal((await readJson<SavedRun>(fileReportStore(directory), manifestKey(sessionId)))?.task, 'Test the save button');
    assert.equal((input as { options: { auth: { attributes: { reportOnCompletion: string } } } }).options.auth.attributes.reportOnCompletion, 'true');
    for (const model of ['anthropic/claude-sonnet-5', 'openai/gpt-5.6-sol', 'google/gemini-3.8-flash']) {
      const modelDispatch = { from: () => ({ send: async (_task: string, options: unknown) => { input = options; return { id: model.split('/')[1] }; } }) } as unknown as RouteHandlerArgs;
      const response = await route('/chat/messages', 'POST')(new Request('http://localhost/chat/messages', { method: 'POST', headers, body: JSON.stringify({ task: 'Compare the cart', initialUrl: 'https://app.example', model }) }), modelDispatch);
      assert.equal(response.status, 202);
      assert.equal((input as { auth: { attributes: { simulatorModel: string } } }).auth.attributes.simulatorModel, model);
      assert.equal((await readJson<SavedRun>(fileReportStore(directory), manifestKey(model.split('/')[1])))?.model, model);
    }
    const pausedId = 'paused-fixture';
    await initializeChatRun(fileReportStore(directory), pausedId, 'Finish the task');
    await retainChatEvent(fileReportStore(directory), pausedId, event('pause-route', 'input.requested', 6, { requests: [{ kind: 'session-limit', requestId: 'resume-this-request' }] }));
    let responseInput: unknown;
    const resumeArgs = { params: { sessionId: pausedId }, attachSession: (id: string) => { assert.equal(id, pausedId); return { respond: async (responses: unknown) => { responseInput = responses; } }; } } as unknown as RouteHandlerArgs;
    const resumeRoute = route('/chat/runs/:sessionId/continue', 'POST');
    assert.equal((await resumeRoute(new Request('http://localhost/chat/runs/x/continue', {method:'POST'}), resumeArgs)).status, 401);
    assert.equal((await resumeRoute(new Request('http://localhost/chat/runs/x/continue', {method:'POST',headers}), resumeArgs)).status, 202);
    assert.deepEqual(responseInput, [{requestId:'resume-this-request',optionId:'continue'}]);
    const incompatibleHost = { from: () => ({ send: async () => { throw Object.assign(new Error('fixture hard-link error'), { code: 'EACCES', syscall: 'link' }); } }) } as unknown as RouteHandlerArgs;
    const unavailable = await route('/chat/messages', 'POST')(new Request('http://localhost/chat/messages', { method: 'POST', headers, body: JSON.stringify({ task: 'Try saving', initialUrl: 'https://app.example' }) }), incompatibleHost);
    assert.equal(unavailable.status, 503);
    assert.match((await unavailable.json()).error, /hard links/);
    const store = await seed(directory);
    await finishChatReport(store, sessionId, { evaluate: report, render: renderReportPdf });
    const download = await route('/chat/runs/:sessionId/report.pdf', 'GET')(new Request('http://localhost/chat/runs/id/report.pdf', { headers }), args);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/pdf');
    assert.match(download.headers.get('content-disposition')!, /attachment/);
    assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    process.env.VERCEL = '1';
    assert.throws(() => reportStore(), /private Vercel Blob/);
  } finally {
    for (const [key, value] of Object.entries({ SIMULATOR_PASSWORD: original.password, REPORTS_DIRECTORY: original.directory, BLOB_READ_WRITE_TOKEN: original.token, BLOB_STORE_ID: original.store, VERCEL: original.vercel })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true });
  }
});

test('token pause saves a note and resumes the same unfinished report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chat-pause-'));
  try {
    const store = fileReportStore(directory);
    for (const e of events.slice(0,5)) await retainChatEvent(store, sessionId, e);
    await retainChatEvent(store, sessionId, event('budget', 'input.requested', 6, { requests: [{kind:'session-limit',requestId:'budget-request'}] }));
    let run=(await savedRuns(store))[0];
    assert.equal(run.status,'paused'); assert.equal(run.pendingRequestId,'budget-request');
    assert.match(run.continuationNote!,/unfinished/);
    assert.ok(await store.read(`runs/${sessionId}/continuation.txt`));
    await finishChatReport(store,sessionId,{evaluate:async()=>{throw Error('Must not evaluate a pause')},render:renderReportPdf});
    assert.equal((await savedRuns(store))[0].status,'paused');
    await retainChatEvent(store,sessionId,event('budget-response','input.resolved',7,{resolutions:[{requestId:'budget-request',kind:'session-limit',response:{optionId:'continue'}}]}));
    run=(await savedRuns(store))[0];
    assert.equal(run.status,'running');assert.equal(run.pendingRequestId,undefined);assert.equal(run.continuationCount,1);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
