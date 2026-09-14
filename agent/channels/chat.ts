import { randomUUID } from 'node:crypto';
import { defineChannel, GET, POST } from 'eve/channels';
import { routeAuth } from 'eve/channels/auth';
import { z } from 'zod';
import { operatorAuth } from '../lib/auth';
import { chatPage } from '../../ui/chat';
import { simulatorModelSchema, defaultSimulatorModel } from '../../lib/models';
import { reportStore, readJson } from '../../lib/report-store';
import { savedRuns, manifestKey, finishChatReport, retainChatFailure, reconcileChatRun, initializeChatRun, type SavedRun } from '../../lib/chat-reports';

export const chatMessageSchema = z.object({
  model: simulatorModelSchema.default(defaultSimulatorModel),
  task: z.string().trim().min(1).max(12000),
  initialUrl: z.string().url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol), 'Use an HTTP or HTTPS app URL').optional(),
  scenario: z.enum(['success', 'recovery', 'false-success']).optional(),
}).strict().refine(value => !(value.initialUrl && value.scenario), 'Choose an app URL or a scenario');
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}
export default defineChannel({
  events: {
    // Eve emits fatal workflow failures outside session context, bypassing hooks.
    async 'session.failed'(data) {
      await retainChatFailure(reportStore(), data);
    },
  },
  routes: [
    GET('/chat', async () => new Response(chatPage, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" } })),
    POST('/chat/messages', async (request, { from }) => {
      const auth = await routeAuth(request, operatorAuth); if (auth instanceof Response) return auth;
      if (!sameOrigin(request)) return json({ error: 'Cross-origin submissions are not allowed' }, 403);
      const parsed = chatMessageSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return json({ error: 'Enter a task of up to 12,000 characters and a valid app URL or scenario, and one of the listed models.' }, 400);
      try { reportStore(); } catch (error) { return json({ error: (error as Error).message }, 503); }
      const { task, scenario, model } = parsed.data;
      const initialUrl = scenario ? new URL(`/fixtures/visual.html?scenario=${scenario}`, process.env.SIMULATOR_PUBLIC_URL || request.url).href : parsed.data.initialUrl || process.env.COMPUTER_INITIAL_URL;
      if (!initialUrl) return json({ error: 'Enter your app URL or choose a test scenario.' }, 400);
      try {
        const session = await from(randomUUID()).send(task, { auth: { ...auth, attributes: { ...auth.attributes, initialUrl, simulatorModel: model, reportOnCompletion: 'true' } } });
        await initializeChatRun(reportStore(), session.id, task, undefined, model);
        return json({ sessionId: session.id }, 202);
      } catch (error) {
        const failure = error as NodeJS.ErrnoException;
        if (failure.code === 'EACCES' && failure.syscall === 'link') return json({ error: 'This host cannot start Eve workflows because filesystem hard links are unavailable. Run the service on Linux or Vercel. Your saved reports can still be downloaded here.' }, 503);
        throw error;
      }
    }),
    GET('/chat/runs', async (request, { attachSession, waitUntil }) => {
      const auth = await routeAuth(request, operatorAuth); if (auth instanceof Response) return auth;
      try {
        const store = reportStore(); const runs = await savedRuns(store);
        const stale = runs.filter(run => run.status !== 'ready' && Date.now() - Date.parse(run.updatedAt) > 30_000);
        if (stale.length) waitUntil((async () => {
          for (const run of stale) {
            try { await reconcileChatRun(store, run.sessionId, () => attachSession(run.sessionId).getEventStream({ startIndex: 0 })); }
            catch (error) { console.error('chat-status-reconciliation-failed', { sessionId: run.sessionId, error: error instanceof Error ? error.name : 'Error' }); }
          }
        })());
        return json({ runs });
      }
      catch (error) { return json({ error: (error as Error).message }, 503); }
    }),
    GET('/chat/runs/:sessionId/report.pdf', async (request, { params }) => {
      const auth = await routeAuth(request, operatorAuth); if (auth instanceof Response) return auth;
      if (!idSchema.safeParse(params.sessionId).success) return json({ error: 'Invalid run ID' }, 400);
      const store = reportStore();
      const manifest = await readJson<SavedRun>(store, manifestKey(params.sessionId));
      if (!manifest) return json({ error: 'Report not found' }, 404);
      if (manifest.status !== 'ready') return json({ error: 'The report is not ready yet.' }, 409);
      const pdf = await store.read(`runs/${params.sessionId}/report.pdf`);
      if (!pdf) return json({ error: 'Report file not found' }, 404);
      return new Response(new Uint8Array(pdf), { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="simulation-${params.sessionId}.pdf"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
    }),
    POST('/chat/runs/:sessionId/continue', async (request, { params, attachSession }) => {
      const auth = await routeAuth(request, operatorAuth); if (auth instanceof Response) return auth;
      if (!sameOrigin(request)) return json({ error: 'Cross-origin submissions are not allowed' }, 403);
      if (!idSchema.safeParse(params.sessionId).success) return json({ error: 'Invalid run ID' }, 400);
      const run = await readJson<SavedRun>(reportStore(), manifestKey(params.sessionId));
      if (!run) return json({ error: 'Report not found' }, 404);
      if (run.status !== 'paused' || !run.pendingRequestId) return json({ error: 'This simulation is not paused for a token budget.' }, 409);
      if (Date.now() - Date.parse(run.startedAt) >= 28 * 60_000) return json({ error: 'The retained browser has expired. Start a new simulation with the saved continuation note; sign in again and verify the current state.' }, 409);
      await attachSession(params.sessionId).respond([{ requestId: run.pendingRequestId, optionId: 'continue' }], { auth });
      return json({ status: 'continuing' }, 202);
    }),
    POST('/chat/runs/:sessionId/stop', async (request, { params, attachSession }) => {
      const auth = await routeAuth(request, operatorAuth); if (auth instanceof Response) return auth;
      if (!sameOrigin(request)) return json({ error: 'Cross-origin submissions are not allowed' }, 403);
      if (!idSchema.safeParse(params.sessionId).success) return json({ error: 'Invalid run ID' }, 400);
      const run = await readJson<SavedRun>(reportStore(), manifestKey(params.sessionId));
      if (!run) return json({ error: 'Report not found' }, 404);
      if (run.status === 'paused' && run.pendingRequestId) {
        await attachSession(params.sessionId).respond([{ requestId: run.pendingRequestId, optionId: 'stop' }], { auth });
        return json({ status: 'stopping' }, 202);
      }
      if (run.status !== 'running') return json({ status: run.status });
      await attachSession(params.sessionId).cancel();
      return json({ status: 'stopping' }, 202);
    }),
    POST('/chat/runs/:sessionId/report', async (request, { params, waitUntil, attachSession }) => {
      const auth = await routeAuth(request, operatorAuth); if (auth instanceof Response) return auth;
      if (!sameOrigin(request)) return json({ error: 'Cross-origin submissions are not allowed' }, 403);
      if (!idSchema.safeParse(params.sessionId).success) return json({ error: 'Invalid run ID' }, 400);
      const store = reportStore();
      let run = await readJson<SavedRun>(store, manifestKey(params.sessionId));
      if (!run) return json({ error: 'Report not found' }, 404);
      if (run.status === 'running') {
        await reconcileChatRun(store, params.sessionId, () => attachSession(params.sessionId).getEventStream({ startIndex: 0 }));
        run = (await readJson<SavedRun>(store, manifestKey(params.sessionId)))!;
      }
      if (run.status === 'running') return json({ error: 'The simulation is still running.' }, 409);
      if (run.status === 'ready' && run.reportKind !== 'evidence-only') return json({ status: 'ready' });
      if (run.status === 'reporting' && Date.now() - Date.parse(run.updatedAt) < 90_000) return json({ status: 'reporting' }, 202);
      waitUntil(finishChatReport(store, params.sessionId, undefined, true));
      return json({ status: 'reporting' }, 202);
    }),
  ],
});
