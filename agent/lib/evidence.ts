import type { EvidenceRun, EvidenceEvent } from "../../lib/evaluation";
import { z } from "zod";
export const terminalSchema = z.object({ state: z.enum(["SUCCESS", "BLOCKED", "FAILED", "LIMIT_REACHED"]), observedState: z.string() });
export type TraceEvent = { type: string; meta: { id: string; at: string }; data?: Record<string, unknown> };

export function evidenceFromTrace(sessionId: string, trace: TraceEvent[]): EvidenceRun {
  const events: EvidenceEvent[] = [];
  let task = "", message = "", failure = "";
  let terminal: EvidenceRun["terminal"] | undefined;
  const inputs = new Map<string, unknown>();
  const seen = new Set<string>();
  for (const event of trace) {
    if (seen.has(event.meta.id)) continue;
    seen.add(event.meta.id);
    const d = event.data ?? {};
    if (event.type === "message.received" && !task) task = String(d.message ?? "");
    if (event.type === "message.completed") message = String(d.message ?? "");
    if (event.type === "result.completed") {
      const parsed = terminalSchema.safeParse(d.result);
      if (parsed.success) terminal = parsed.data;
    }
    if (["turn.failed", "session.failed", "turn.cancelled"].includes(event.type)) failure = String(d.message ?? d.code ?? event.type);
    if (event.type === "input.resolved" && Array.isArray(d.resolutions) &&
      (d.resolutions as { kind?: string; response?: { optionId?: string } }[]).some(r => r.kind === "session-limit" && r.response?.optionId === "continue")) failure = "";
    if (event.type === "input.requested" && Array.isArray(d.requests)) {
      const limit = (d.requests as { kind?: string; action?: { input?: { kind?: string; limit?: number } } }[]).find(request => request.kind === "session-limit");
      if (limit) failure = `LIMIT_REACHED: ${limit.action?.input?.kind ?? "session"} token budget (${limit.action?.input?.limit ?? "configured limit"})`;
    }
    if (event.type === "actions.requested" && Array.isArray(d.actions)) {
      for (const action of d.actions as {callId:string;input:unknown}[]) inputs.set(action.callId, action.input);
    }
    if (event.type === "action.result") {
      const r = d.result as { callId?: string; toolName?: string; output?: unknown; isError?: boolean } | undefined;
      if (!r?.callId || !["screen", "mouse", "keyboard"].includes(r.toolName ?? "")) continue;
      const output = r.output as Record<string, unknown> | undefined;
      const item: EvidenceEvent = { id: event.meta.id, timestamp: event.meta.at, kind: r.toolName as EvidenceEvent["kind"], input: inputs.get(r.callId) ?? {}, result: r.output };
      if (r.isError || d.status === "failed" || d.status === "rejected") item.error = JSON.stringify(d.error ?? r.output);
      if (r.toolName === "screen" && !item.error && typeof output?.base64 === "string") {
        item.observation = { base64: output.base64, mediaType: "image/png", width: Number(output.width), height: Number(output.height) };
        item.result = { width: output.width, height: output.height };
      }
      events.push(item);
    }
  }
  if (!terminal) {
    try {
      const cleaned = message.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      const jsonStart = cleaned.startsWith("{") ? 0 : cleaned.lastIndexOf("\n{") + 1;
      terminal = terminalSchema.parse(JSON.parse(cleaned.slice(jsonStart)));
    } catch { terminal = { state: "FAILED", observedState: message || "No valid terminal result was produced." }; }
  }
  if (failure) terminal = { state: failure.includes("LIMIT_REACHED") ? "LIMIT_REACHED" : "FAILED", observedState: "Eve runtime stopped the turn: " + failure };
  return { sessionId, task, startedAt: trace[0]?.meta.at ?? new Date().toISOString(), finishedAt: trace.at(-1)?.meta.at ?? new Date().toISOString(), terminal, events };
}

export async function readCompletedTrace(stream: ReadableStream<TraceEvent>): Promise<TraceEvent[]> {
  const reader = stream.getReader();
  const events: TraceEvent[] = [];
  let bytes = 0;
  const timeout = setTimeout(() => void reader.cancel(), 25_000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += JSON.stringify(value).length;
      if (bytes > 100_000_000) throw new Error("Trace exceeds export size limit");
      events.push(value);
      if (["session.waiting", "session.completed", "session.failed"].includes(value.type)) return events;
    }
    throw new Error("Run is not yet complete; retry the evidence request");
  } finally { clearTimeout(timeout); await reader.cancel(); }
}
