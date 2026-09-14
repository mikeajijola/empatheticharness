import { randomUUID } from "node:crypto";
import { defineChannel, GET, POST } from "eve/channels";
import { routeAuth } from "eve/channels/auth";
import { z } from "zod";
import { operatorAuth } from "../lib/auth";
import { evidenceFromTrace, readCompletedTrace } from "../lib/evidence";
import { evaluateRun } from "../../lib/evaluation";
import { visualFixture } from "../../fixtures/visual";
const requestSchema = z.object({
  task: z.string().min(1).max(12000),
  scenario: z.enum(["navigation", "form", "scroll", "modal", "validation", "recovery", "ambiguous", "delay", "false-success", "success"]).optional(),
}).strict();
export default defineChannel({
  routes: [
    GET("/fixtures/visual.html", async () => new Response(visualFixture, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })),
    POST("/runs", async (request, { from }) => {
      const auth = await routeAuth(request, operatorAuth);
      if (auth instanceof Response) return auth;
      const parsed = requestSchema.safeParse(await request.json());
      if (!parsed.success) return Response.json({ error: "Invalid task or scenario" }, { status: 400 });
      const { task, scenario } = parsed.data;
      const initialUrl = scenario ? new URL(`/fixtures/visual.html?scenario=${scenario}`, process.env.SIMULATOR_PUBLIC_URL || request.url).href : process.env.COMPUTER_INITIAL_URL;
      if (!initialUrl) return Response.json({ error: "Configure COMPUTER_INITIAL_URL or choose a fixture scenario" }, { status: 400 });
      const session = await from(randomUUID()).send(task, { auth: { ...auth, attributes: { ...auth.attributes, initialUrl } } });
      return Response.json({ sessionId: session.id }, { status: 202 });
    }),
    GET("/runs/:sessionId/stream", async (request, { attachSession, params }) => {
      const auth = await routeAuth(request, operatorAuth);
      if (auth instanceof Response) return auth;
      return new Response((await attachSession(params.sessionId).getEventStream({ startIndex: 0 })).pipeThrough(new TransformStream({ transform(event, controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n")); } })), { headers: { "content-type": "application/x-ndjson" } });
    }),
    GET("/runs/:sessionId/evidence", async (request, { attachSession, params }) => {
      const auth = await routeAuth(request, operatorAuth);
      if (auth instanceof Response) return auth;
      try {
        const trace = await readCompletedTrace(await attachSession(params.sessionId).getEventStream({ startIndex: 0 }));
        return Response.json(evidenceFromTrace(params.sessionId, trace));
      } catch (error) { return Response.json({ error: String(error) }, { status: 409 }); }
    }),
    GET("/runs/:sessionId/evaluation", async (request, { attachSession, params }) => {
      const auth = await routeAuth(request, operatorAuth);
      if (auth instanceof Response) return auth;
      const trace = await readCompletedTrace(await attachSession(params.sessionId).getEventStream({ startIndex: 0 }));
      return Response.json(await evaluateRun(evidenceFromTrace(params.sessionId, trace), { model: process.env.EVALUATOR_MODEL || "google/gemini-2.5-flash" }));
    }),
  ],
});
