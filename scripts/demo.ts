import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderReportPdf } from "../lib/report-pdf";
import { visualCases } from "../evals/visual/cases";
import { evidenceRunSchema } from "../lib/evaluation";
const origin = process.argv[2];
if (!origin || !process.env.SIMULATOR_PASSWORD) throw new Error("Usage: node --env-file=.env.local --import tsx scripts/demo.ts https://deployment [scenario ...]");
const scenarios = process.argv.slice(3).length ? process.argv.slice(3) : ["success", "recovery", "false-success"];
const authorization = `Bearer ${process.env.SIMULATOR_PASSWORD}`;
async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(new URL(path, origin), { ...init, redirect: "error", headers: { ...init.headers, authorization }, signal: AbortSignal.timeout(720_000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response;
}
for (const argument of scenarios) {
  const [scenario, existingSessionId] = argument.split(":");
  const c = visualCases.find(c => c.scenario === scenario);
  if (!c) throw new Error(`Unknown scenario: ${scenario}`);
  const { sessionId } = existingSessionId ? { sessionId: existingSessionId } : await (await request("/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario, task: c.task }) })).json();
  const directory = join("evidence", "runs", `${scenario}-${sessionId}`);
  await mkdir(directory, { recursive: true });
  console.log(JSON.stringify({ scenario, sessionId, status: "started" }));
  let raw = "", complete = false, cursor = 0;
  const deadline = Date.now() + 720_000;
  while (!complete && Date.now() < deadline) {
    const decoder = new TextDecoder();
    let pending = "";
    const stream = (await request(`/eve/v1/session/${sessionId}/stream?startIndex=${cursor}`)).body!;
    const reader = stream.getReader();
    try {
      while (!complete) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, index); pending = pending.slice(index + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          raw += JSON.stringify(event) + "\n"; cursor++;
          if (["action.result", "message.completed", "turn.failed", "session.failed"].includes(event.type))
            console.log(JSON.stringify({ scenario, type: event.type, tool: event.data?.result?.toolName, error: event.data?.error, message: event.data?.message }));
          if (["session.waiting", "session.failed", "session.completed"].includes(event.type)) complete = true;
        }
      }
    } catch (error) { console.log(JSON.stringify({ scenario, status: "reconnecting", cursor, reason: error instanceof Error ? error.name : "stream error" })); }
    finally { await reader.cancel().catch(() => undefined); await writeFile(join(directory, "trace.ndjson"), raw); }
    if (!complete) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!complete) throw new Error(`Timed out retaining trace for ${sessionId}`);
  const evidence = evidenceRunSchema.parse(await (await request(`/runs/${sessionId}/evidence`)).json());
  await writeFile(join(directory, "evidence.json"), JSON.stringify(evidence, null, 2));
  let n = 0;
  for (const event of evidence.events) if (event.observation) await writeFile(join(directory, `${String(n++).padStart(3, "0")}.png`), Buffer.from(event.observation.base64, "base64"));
  const report = await (await request(`/runs/${sessionId}/evaluation`)).json();
  await writeFile(join(directory, "evaluation.json"), JSON.stringify(report, null, 2));
  await writeFile(join(directory, "report.pdf"), await renderReportPdf(evidence, report));
  console.log(JSON.stringify({ scenario, sessionId, terminal: evidence.terminal, evaluation: report, directory }));
}
