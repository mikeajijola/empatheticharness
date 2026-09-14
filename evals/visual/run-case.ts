import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineEval, type EveEvalContext } from 'eve/evals';
import { equals, satisfies } from 'eve/evals/expect';
import { deriveMetrics, evidenceRunSchema, validateJudgment, type EvaluationReport } from '../../lib/evaluation.js';
import type { VisualCase } from './cases.js';

async function requestJson(t: EveEvalContext, path: string, init?: RequestInit): Promise<unknown> {
  const retryable = !init?.method || init.method === "GET";
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await t.target.fetch(path, { ...init, signal: t.signal });
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
      return await response.json();
    } catch (error) {
      t.signal.throwIfAborted();
      if (!retryable || !(error instanceof TypeError) || attempt >= 2) throw error;
      await delay(1000, undefined, { signal: t.signal });
    }
  }
}


async function waitForEvidence(t: EveEvalContext, sessionId: string) {
  const path = `/runs/${encodeURIComponent(sessionId)}/evidence`;
  while (true) {
    t.signal.throwIfAborted();
    let response: Response;
    try { response = await t.target.fetch(path, { signal: t.signal }); }
    catch (error) {
      t.signal.throwIfAborted();
      if (!(error instanceof TypeError)) throw error;
      await delay(1000, undefined, { signal: t.signal });
      continue;
    }
    if (response.ok) return evidenceRunSchema.parse(await response.json());
    if (response.status !== 409 && response.status < 500) throw new Error(`${path}: HTTP ${response.status}`);
    await response.body?.cancel();
    await delay(1000, undefined, { signal: t.signal });
  }
}

export function visualEval(testCase: VisualCase) {
  return defineEval({
    description: testCase.description,
    tags: ['visual', 'multimodal', 'live', testCase.scenario],
    metadata: { scenario: testCase.scenario, requires: 'real visual actor, graphical provider, independent vision judge' },
    async test(t) {
      // Operator setup selects the initial URL. The actor receives only the task
      // and uses its genuine Eve screen/mouse/keyboard tool implementations.
      const existing = JSON.parse(process.env.SIMULATOR_EVAL_SESSIONS || "{}") as Record<string, string>;
      const started = existing[testCase.scenario] ? { sessionId: existing[testCase.scenario] } : await requestJson(t, '/runs', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ task: testCase.task, scenario: testCase.scenario }),
      }) as { sessionId?: string };
      const sessionId = await t.require(started.sessionId,
        satisfies(value => typeof value === 'string' && value.length > 0, 'durable Eve session id'));
      const directory = join("evidence", "runs", `${testCase.scenario}-${sessionId}`);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "session.json"), JSON.stringify({ scenario: testCase.scenario, sessionId, task: testCase.task }, null, 2));
      const evidence = await waitForEvidence(t, sessionId!);
      await writeFile(join(directory, "evidence.json"), JSON.stringify(evidence, null, 2));
      let imageIndex = 0;
      for (const event of evidence.events) if (event.observation) await writeFile(join(directory, `${String(imageIndex++).padStart(3, "0")}.png`), Buffer.from(event.observation.base64, "base64"));
      const session = await t.target.attachSession(sessionId!);
      await writeFile(join(directory, "trace.ndjson"), session.events.map(event => JSON.stringify(event)).join("\n") + "\n");
      session.succeeded();
      session.calledTool('screen');
      session.calledTool('mouse', { input: { action: 'click' } });
      if (testCase.keyboard) session.calledTool('keyboard');
      if (testCase.scroll) session.calledTool('mouse', { input: { action: 'scroll' } });
      session.eventsSatisfy('only the three environmental tools are requested', events =>
        events.every(event => event.type !== 'actions.requested' || event.data.actions.every(action =>
          action.kind === 'tool-call' && ['screen', 'mouse', 'keyboard'].includes(action.toolName))));

      t.check(evidence.sessionId, equals(sessionId));
      t.check(evidence.task, equals(testCase.task));
      t.check(evidence.events[0]?.observation !== undefined, equals(true)).label('initial rendered screenshot');
      t.check(evidence.events.at(-1)?.observation !== undefined, equals(true)).label('final rendered screenshot');
      t.check(evidence.events.filter(event => event.observation).length,
        satisfies(count => typeof count === 'number' && count >= 2, 'at least initial and final observations'));

      // This separate model consumes original task + chronological image parts;
      // do not use t.reply or a text-only autoeval as proof of visual completion.
      const report = await requestJson(t, `/runs/${encodeURIComponent(sessionId!)}/evaluation`) as EvaluationReport;
      await writeFile(join(directory, "evaluation.json"), JSON.stringify(report, null, 2));
      t.check(report.sessionId, equals(sessionId));
      const judgment = validateJudgment(evidence, report.judgment);
      const metrics = deriveMetrics(evidence, judgment);
      t.check(judgment.verifiedSuccess, equals(testCase.success)).label('independent visible task completion');
      t.check(metrics.falseFulfillment, equals(false)).label('no false success claim');
      t.check(judgment.confidence, satisfies(value => typeof value === 'number' && value >= 0.7, 'judge confidence at least 0.7'));
      if (testCase.success) t.check(evidence.terminal.state, equals('SUCCESS'));
      else {
        t.check(evidence.terminal.state, equals('BLOCKED')).label('publication failure reported as blocked');
        t.check(judgment.visibleBlockers.length, satisfies(value => typeof value === 'number' && value > 0, 'visible publishing blocker cited'));
      }
      if (testCase.recovery) t.check(metrics.successfulRecoveryCount,
        satisfies(value => typeof value === 'number' && value >= 1, 'visible recovery verified'));
      t.log(JSON.stringify({ scenario: testCase.scenario, sessionId, judgment, metrics,
        evidencePath: `/runs/${sessionId}/evidence`, streamPath: `/runs/${sessionId}/stream` }));
    },
  });
}
