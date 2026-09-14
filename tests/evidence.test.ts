import test from "node:test";
import assert from "node:assert/strict";
import { evidenceFromTrace, readCompletedTrace, type TraceEvent } from "../agent/lib/evidence";
function event(type: string, data: Record<string, unknown> = {}, id = type): TraceEvent {
  return { type, data, meta: { id, at: "2026-09-07T10:00:00.000Z" } };
}
test("exports tool input, screenshot, errors and terminal from native durable events", () => {
  const screenshot = event("action.result", { status: "completed", result: { callId: "a", toolName: "screen", output: { base64: "png", mediaType: "image/png", width: 1280, height: 800 } } }, "capture");
  const trace = [event("message.received", { message: "Save the setting" }), event("actions.requested", { actions: [{ callId: "a", input: {} }, { callId: "b", input: { action: "click", x: 40, y: 60 } }] }), screenshot, screenshot,
    event("action.result", { status: "failed", result: { callId: "b", toolName: "mouse", output: "ACTION_UNCERTAIN", isError: true } }, "failed-click"),
    event("message.completed", { message: '{"state":"BLOCKED","observedState":"Save did not finish"}' })];
  const run = evidenceFromTrace("session", trace);
  assert.equal(run.task, "Save the setting");
  assert.equal(run.events.length, 2);
  assert.equal(run.events[0].observation?.base64, "png");
  assert.deepEqual(run.events[1].input, { action: "click", x: 40, y: 60 });
  assert.match(run.events[1].error!, /ACTION_UNCERTAIN/);
  assert.equal(run.terminal.state, "BLOCKED");
});
test("runtime failures override earlier actor success and preserve limits", () => {
  const trace = [event("message.completed", { message: '{"state":"SUCCESS","observedState":"Clicked"}' }), event("turn.failed", { message: "LIMIT_REACHED" })];
  assert.equal(evidenceFromTrace("session", trace).terminal.state, "LIMIT_REACHED");
});
test("completed trace export stops at session waiting and cancels reader", async () => {
  let cancelled = false;
  const stream = new ReadableStream<TraceEvent>({ start(c) { c.enqueue(event("session.started")); c.enqueue(event("session.waiting")); }, cancel() { cancelled = true; } });
  assert.equal((await readCompletedTrace(stream)).length, 2);
  assert.equal(cancelled, true);
});

test("legacy assistant prose before the final JSON does not discard a terminal claim", () => {
  const trace = [event("message.completed", { message: 'The saved setting is visible.\n\n{"state":"SUCCESS","observedState":"Weekly summary: On"}' })];
  assert.equal(evidenceFromTrace("session", trace).terminal.state, "SUCCESS");
});
test("native structured result is preferred over assistant prose", () => {
  const trace = [event("message.completed", { message: "The task is finished." }), event("result.completed", { result: { state: "BLOCKED", observedState: "Service unavailable" } })];
  assert.equal(evidenceFromTrace("session", trace).terminal.state, "BLOCKED");
});

test('native session budget approval pauses are reported as execution limits', () => {
  const trace = [
    { type: 'session.started', meta: { id: 'start', at: '2026-09-09T00:00:00Z' } },
    { type: 'input.requested', meta: { id: 'budget', at: '2026-09-09T00:01:00Z' }, data: { requests: [{ kind: 'session-limit', action: { input: { kind: 'input', limit: 500000 } } }] } },
    { type: 'session.waiting', meta: { id: 'wait', at: '2026-09-09T00:01:01Z' } },
  ];
  const evidence = evidenceFromTrace('budget-run', trace);
  assert.equal(evidence.terminal.state, 'LIMIT_REACHED');
  assert.match(evidence.terminal.observedState, /input token budget \(500000\)/);
});

test('approved token continuation does not poison a later successful result', () => {
  const trace = [
    { type: 'input.requested', meta: { id:'limit', at:'2026-09-10T00:00:00Z' }, data:{requests:[{kind:'session-limit'}]} },
    { type: 'input.resolved', meta: { id:'resume', at:'2026-09-10T00:00:01Z' }, data:{resolutions:[{kind:'session-limit',response:{optionId:'continue'}}]} },
    { type: 'result.completed', meta: { id:'final', at:'2026-09-10T00:00:02Z' }, data:{result:{state:'SUCCESS',observedState:'Final state observed'}} },
  ];
  assert.equal(evidenceFromTrace('continued',trace).terminal.state,'SUCCESS');
});
