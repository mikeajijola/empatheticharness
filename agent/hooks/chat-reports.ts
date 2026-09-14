import { defineHook } from 'eve/hooks';
import { reportStore, readJson } from '../../lib/report-store';
import { retainChatEvent, finishChatReport, manifestKey, type SavedRun } from '../../lib/chat-reports';

export default defineHook({ events: {
  async '*'(event, ctx) {
    if (ctx.session.auth.initiator?.attributes.reportOnCompletion !== 'true') return;
    const store = reportStore();
    const model = ctx.session.auth.initiator?.attributes.simulatorModel;
    await retainChatEvent(store, ctx.session.id, event, typeof model === 'string' ? model : undefined);
    if (['session.waiting', 'session.completed', 'session.failed'].includes(event.type)) {
      const run = await readJson<SavedRun>(store, manifestKey(ctx.session.id));
      if (event.type === 'session.waiting' && run?.status === 'paused') {
        // User-authorized simulation spans turns. Native request IDs deduplicate retries.
        if ((run.continuationCount ?? 0) < 3 && Date.now() - Date.parse(run.startedAt) < 28 * 60_000 &&
            process.env.SIMULATOR_PUBLIC_URL && process.env.SIMULATOR_PASSWORD) {
          try {
            const response = await fetch(new URL(`/chat/runs/${ctx.session.id}/continue`, process.env.SIMULATOR_PUBLIC_URL), {
              method: 'POST', headers: { authorization: 'Bearer ' + process.env.SIMULATOR_PASSWORD }, signal: AbortSignal.timeout(10_000),
            });
            if (!response.ok) console.warn('automatic-continuation-deferred', { sessionId: ctx.session.id, status: response.status });
          } catch { console.warn('automatic-continuation-deferred', { sessionId: ctx.session.id }); }
        }
        return;
      }
      await finishChatReport(store, ctx.session.id);
    }
  },
} });
