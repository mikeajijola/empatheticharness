import PDFDocument from 'pdfkit';
import { simulatorModels } from './models';
import { gunzipSync } from 'node:zlib';
import { regular, bold } from './report-fonts';
const regularFont = gunzipSync(Buffer.from(regular, 'base64'));
const boldFont = gunzipSync(Buffer.from(bold, 'base64'));
import { evidenceRunSchema, validateJudgment, deriveMetrics, type EvidenceRun, type EvaluationReport } from './evaluation';

/** Render retained evidence without making another model call. */
export async function renderReportPdf(evidence: EvidenceRun, report: EvaluationReport): Promise<Buffer> {
  const run = evidenceRunSchema.parse(evidence);
  if (report.sessionId !== run.sessionId) throw new Error('Report and evidence session IDs differ');
  const judgment = validateJudgment(run, report.judgment);
  const metrics = deriveMetrics(run, judgment);
  const doc = new PDFDocument({ font: '', size: 'A4', margin: 48, bufferPages: true, info: { Title: 'User simulation report', Subject: run.task } });
  doc.registerFont('Report', regularFont).registerFont('Report-Bold', boldFont).font('Report');
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const heading = (title: string) => { if (doc.y > 700) doc.addPage(); doc.moveDown(0.6).font('Report-Bold').fontSize(15).fillColor('#17324d').text(title).moveDown(0.4); };
  const body = (text: string) => { doc.font('Report').fontSize(11).fillColor('#243447').text(text, { lineGap: 4 }).moveDown(0.5); };
  doc.font('Report-Bold').fontSize(26).fillColor('#17324d').text('User simulation report');
  heading(report.kind === 'evidence-only' ? 'Evidence report — analysis unavailable' : judgment.verifiedSuccess === true ? 'Task completed' : judgment.verifiedSuccess === false ? 'Task not completed' : 'Outcome unverified');
  body(`Session: ${run.sessionId}${run.model ? '\nModel: ' + (simulatorModels.find(model => model.id === run.model)?.label ?? run.model) : ''}\nStarted: ${run.startedAt}\nFinished: ${run.finishedAt}`);
  heading('Task'); body(run.task);
  heading('What happened'); body(judgment.rationale);
  const observation = run.terminal.observedState.includes('Free tier users do not have access to this model')
    ? 'Vercel AI Gateway reported a free-tier model restriction. Check the team’s Gateway access and billing settings. This error does not establish a problem with the app.'
    : run.terminal.observedState.startsWith('Eve runtime stopped the turn:')
    ? run.terminal.state === 'LIMIT_REACHED'
      ? 'The run stopped after reaching its execution limit. Technical details are retained in evidence.json.'
      : 'A runtime error stopped the run. Technical details are retained in evidence.json.'
    : run.terminal.observedState;
  body(`Simulator status: ${run.terminal.state}\nSimulator observation: ${observation}`);
  if (report.kind !== 'evidence-only') body(`Evaluator confidence: ${Math.round(judgment.confidence * 100)}% (subjective confidence, not a measured probability).`);
  heading('Run metrics');
  const seconds = Math.round(metrics.completionLatencyMs / 1000);
  if (report.kind === 'evidence-only') body(`Duration: ${Math.floor(seconds / 60)}m ${seconds % 60}s\nActions: ${metrics.actionCount} | Screenshots: ${metrics.observationCount}\nRecovery, backtracking and usability findings have not been assessed.`);
  else body(`Duration: ${Math.floor(seconds / 60)}m ${seconds % 60}s\nActions: ${metrics.actionCount} | Screenshots: ${metrics.observationCount} | Total interactions: ${metrics.totalInteractions}\nRecoveries: ${metrics.successfulRecoveryCount} resolved / ${metrics.recoveryCount} attempted\nRepeated actions: ${metrics.repeatedActions} | Repeated loops: ${metrics.repeatedLoops} | Backtracking: ${metrics.backtrackingCount}\nIncorrect success claim: ${metrics.falseFulfillment === null ? 'Unverified' : metrics.falseFulfillment ? 'Yes' : 'No'}`);
  for (const [title, findings] of [['Visible blockers', judgment.visibleBlockers], ['Usability friction', judgment.uxFriction]] as const) {
    heading(title);
    if (!findings.length) body(report.kind === 'evidence-only' ? 'Not assessed. Independent AI analysis was unavailable.' : 'None identified in the available evidence.');
    for (const finding of findings) { body(finding.description); body(`Evidence: ${finding.eventIds.join(', ')}`); }
  }
  if (judgment.recoveries.length) {
    heading('Recovery attempts');
    for (const recovery of judgment.recoveries) body(`Trigger: ${recovery.triggerEventId}\nAttempt: ${recovery.attemptEventId}\nResolution: ${recovery.resolvedEventId ?? 'Not visually confirmed'}`);
  }
  if (judgment.backtrackingEventIds.length) { heading('Backtracking evidence'); body(judgment.backtrackingEventIds.join('\n')); }
  if (report.kind === 'evidence-only') {
    heading('Recorded activity');
    for (const event of run.events) body(`${event.timestamp} — ${event.kind}${event.error ? ' (interaction failed)' : ''}\nEvent: ${event.id}`);
  }
  const referenced = new Set([...judgment.evidenceEventIds, ...judgment.visibleBlockers.flatMap(f => f.eventIds), ...judgment.uxFriction.flatMap(f => f.eventIds), ...judgment.recoveries.flatMap(r => [r.triggerEventId, r.attemptEventId, ...(r.resolvedEventId ? [r.resolvedEventId] : [])])]);
  const observations = run.events.filter(event => event.observation);
  const selected = observations.filter((event, index) => index === 0 || index === observations.length - 1 || referenced.has(event.id));
  for (const event of selected) {
    doc.addPage(); heading('Screenshot evidence');
    body(`${event.timestamp}\nEvent: ${event.id}${referenced.has(event.id) && report.kind !== 'evidence-only' ? '\nReferenced by the evaluator' : ''}`);
    const top = doc.y;
    doc.image(Buffer.from(event.observation!.base64, 'base64'), 48, top, { fit: [499, 740 - top], align: 'center' });
  }
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.font('Report').fontSize(8).fillColor('#64748b').text(`Empathetic Harness  |  Page ${i + 1} of ${pages.count}`, 48, 785, { lineBreak: false });
  }
  doc.end();
  return result;
}
