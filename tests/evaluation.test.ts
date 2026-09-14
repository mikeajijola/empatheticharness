import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateEvaluations, buildEvaluationMessages, deriveMetrics, evidenceRunSchema, validateJudgment, groundCompletionJudgment,
  type EvidenceRun, type EvaluationJudgment } from '../lib/evaluation.ts';

const observation = { base64: 'c2NyZWVuc2hvdA==', mediaType: 'image/png' as const, width: 800, height: 600 };
const run: EvidenceRun = {
  sessionId: 'fixture-false-success', task: 'Save the display name as Sam',
  startedAt: '2026-09-07T10:00:00.000Z', finishedAt: '2026-09-07T10:00:10.000Z',
  terminal: { state: 'SUCCESS', observedState: 'The success toast says saved' },
  events: [
    { id: 's1', timestamp: '2026-09-07T10:00:01.000Z', kind: 'screen', input: {}, observation },
    { id: 'a1', timestamp: '2026-09-07T10:00:02.000Z', kind: 'mouse', input: { x: 10, y: 20 } },
    { id: 's2', timestamp: '2026-09-07T10:00:03.000Z', kind: 'screen', input: {}, observation },
    { id: 'a2', timestamp: '2026-09-07T10:00:04.000Z', kind: 'mouse', input: { y: 20, x: 10 } },
    { id: 'a3', timestamp: '2026-09-07T10:00:05.000Z', kind: 'mouse', input: { x: 10, y: 20 } },
    { id: 's3', timestamp: '2026-09-07T10:00:06.000Z', kind: 'screen', input: {}, observation },
  ],
};
const judgment: EvaluationJudgment = {
  verifiedSuccess: false, confidence: 0.9, evidenceEventIds: ['s3'],
  rationale: 'Fixture judgment: the persisted name is unchanged despite the toast.',
  visibleBlockers: [], uxFriction: [{ description: 'Misleading confirmation toast', eventIds: ['s3'] }],
  recoveries: [], backtrackingEventIds: [],
};

test('false-success claim cannot override an independent negative verdict', () => {
  const metrics = deriveMetrics(run, judgment);
  assert.equal(metrics.taskSuccess, false);
  assert.equal(metrics.falseFulfillment, true);
  assert.equal(metrics.actionCount, 3);
  assert.equal(metrics.observationCount, 3);
  assert.equal(metrics.totalInteractions, 6);
  assert.equal(metrics.completionLatencyMs, 10_000);
  assert.equal(metrics.repeatedActions, 2);
  assert.equal(metrics.repeatedLoops, 1);
});

test('unknown outcome remains unknown, and empty datasets have no rates', () => {
  const unknown = { ...judgment, verifiedSuccess: null, evidenceEventIds: [], confidence: 0 };
  const metrics = deriveMetrics(run, unknown);
  assert.equal(metrics.falseFulfillment, null);
  const aggregate = aggregateEvaluations([{ sessionId: run.sessionId, judgment: unknown, metrics }]);
  assert.equal(aggregate.successRate, null);
  assert.equal(aggregate.falseFulfillmentRate, null);
  assert.equal(aggregate.unknownSuccessCount, 1);
  const empty = aggregateEvaluations([]);
  assert.equal(empty.runCount, 0);
  assert.equal(empty.successRate, null);
  assert.equal(empty.blockedRate, null);
  assert.equal(empty.meanActionCount, null);
});

test('invented citations and unsupported visual conclusions are rejected', () => {
  assert.throws(() => validateJudgment(run, { ...judgment, evidenceEventIds: ['invented'] }), /unknown event/);
  assert.throws(() => validateJudgment(run, { ...judgment, evidenceEventIds: ['a1'] }), /screenshot evidence/);
  assert.throws(() => evidenceRunSchema.parse({ ...run, events: [run.events[0], run.events[0]] }), /unique/);
});

test('recovery resolution needs later screenshot evidence', () => {
  const recovered = { ...judgment, recoveries: [{ triggerEventId: 's1', attemptEventId: 'a1', resolvedEventId: 's2' }] };
  assert.equal(deriveMetrics(run, recovered).successfulRecoveryCount, 1);
  assert.throws(() => validateJudgment(run, { ...recovered, recoveries: [{ ...recovered.recoveries[0], resolvedEventId: 's1' }] }), /Recovery/);
  assert.throws(() => validateJudgment(run, { ...recovered, recoveries: [...recovered.recoveries, ...recovered.recoveries] }), /Duplicate/);
});

test('verified success must cite the final successful screenshot', () => {
  const success = { ...judgment, verifiedSuccess: true, uxFriction: [] };
  assert.equal(validateJudgment(run, success).verifiedSuccess, true);
  assert.throws(() => validateJudgment(run, { ...success, evidenceEventIds: ['s1'] }), /final successful screenshot/);
  const stale = { ...run, events: run.events.slice(0, -1) };
  assert.throws(() => validateJudgment(stale, { ...success, evidenceEventIds: ['s2'] }), /after the final physical action/);
  const failedCapture = { ...run, events: run.events.map(event => event.id === 's3' ? { ...event, error: 'Capture failed' } : event) };
  assert.throws(() => validateJudgment(failedCapture, success), /after the final physical action/);
});

test('SUCCESS without screenshots cannot receive a verified completion judgment', () => {
  const noScreenshots = { ...run, events: run.events.filter(event => event.kind !== 'screen') };
  assert.throws(() => validateJudgment(noScreenshots, {
    ...judgment, verifiedSuccess: true, evidenceEventIds: ['a3'], uxFriction: [],
  }), /screenshot evidence/);
  const unknown = { ...judgment, verifiedSuccess: null, evidenceEventIds: [], uxFriction: [] };
  assert.equal(deriveMetrics(noScreenshots, unknown).taskSuccess, null);
});

test('evaluator receives chronological image parts independently of the simulator', () => {
  const messages = buildEvaluationMessages(run);
  assert.equal(messages.length, 1);
  const content = messages[0].content;
  assert.ok(Array.isArray(content));
  assert.equal(content.filter(part => part.type === 'file').length, 3);
  assert.equal(content[2].type, 'file');
  assert.equal(content[1].type, 'text');
  assert.match(JSON.stringify(content[1]), /s1/);
});

test('duplicate sessions cannot inflate aggregate rates', () => {
  const report = { sessionId: run.sessionId, judgment, metrics: deriveMetrics(run, judgment) };
  assert.throws(() => aggregateEvaluations([report, report]), /Duplicate session/);
});


test('unobserved final actions downgrade completion without discarding supported findings', () => {
  const interrupted = { ...run, events: run.events.slice(0, -1) };
  const candidate = { ...judgment, verifiedSuccess: true, evidenceEventIds: ['s2'], uxFriction: [{ description: 'Observed friction', eventIds: ['s2'] }] };
  const grounded = groundCompletionJudgment(interrupted, candidate);
  assert.equal(grounded.verifiedSuccess, null);
  assert.equal(grounded.confidence, 0);
  assert.deepEqual(grounded.uxFriction, candidate.uxFriction);
  assert.equal(candidate.verifiedSuccess, true);
  assert.throws(() => groundCompletionJudgment(interrupted, { ...candidate, evidenceEventIds: ['invented'] }), /unknown event/);
});
