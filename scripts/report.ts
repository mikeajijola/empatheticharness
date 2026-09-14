import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderReportPdf } from '../lib/report-pdf';

const directory = process.argv[2];
if (!directory) throw new Error('Usage: npm run report -- evidence/runs/<scenario-sessionId> [output.pdf]');
const output = process.argv[3] || join(directory, 'report.pdf');
const evidence = JSON.parse(await readFile(join(directory, 'evidence.json'), 'utf8'));
const evaluation = JSON.parse(await readFile(join(directory, 'evaluation.json'), 'utf8'));
await writeFile(output, await renderReportPdf(evidence, evaluation));
console.log(`PDF report saved: ${output}`);
