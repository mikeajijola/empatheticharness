import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evidenceRunSchema, validateJudgment, deriveMetrics, type EvaluationReport } from '../lib/evaluation';
import { renderReportPdf } from '../lib/report-pdf';
import { reportStore, writeJson } from '../lib/report-store';
import { manifestKey, type SavedRun } from '../lib/chat-reports';
const directory = process.argv[2];
if (!directory) throw new Error('Usage: npm run report:import -- evidence/runs/<run-folder>');
const evidence = evidenceRunSchema.parse(JSON.parse(await readFile(join(directory, 'evidence.json'), 'utf8')));
const report: EvaluationReport = JSON.parse(await readFile(join(directory, 'evaluation.json'), 'utf8'));
const judgment = validateJudgment(evidence, report.judgment);
const metrics = deriveMetrics(evidence, judgment);
const pdf = await renderReportPdf(evidence, report);
const store = reportStore();
await writeJson(store, `runs/${evidence.sessionId}/evidence.json`, evidence);
await writeJson(store, `runs/${evidence.sessionId}/evaluation.json`, report);
await store.write(`runs/${evidence.sessionId}/report.pdf`, pdf);
await writeJson(store, manifestKey(evidence.sessionId), {
  sessionId: evidence.sessionId, task: evidence.task, startedAt: evidence.startedAt, updatedAt: new Date().toISOString(), status: 'ready',
  activity: 'Your PDF report is ready', actionCount: metrics.actionCount, observationCount: metrics.observationCount,
  outcome: judgment.verifiedSuccess, rationale: judgment.rationale,
} satisfies SavedRun);
console.log(`Imported saved report ${evidence.sessionId}. View it at /chat.`);
