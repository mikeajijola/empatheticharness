import { defineHook } from 'eve/hooks';
import { reportStore, readJson } from '../../lib/report-store';
import { manifestKey, type SavedRun } from '../../lib/chat-reports';
import { releaseComputer } from '../lib/computer.js';

// Each simulation is one task per session. Hooks run after durable publication,
// so stopping browser compute preserves action results and screenshot evidence.
export default defineHook({
  events: {
    async 'turn.cancelled'(_event, ctx) {
      await releaseComputer(ctx.session.id);
    },
    async 'turn.completed'(_event, ctx) {
      const run = await readJson<SavedRun>(reportStore(), manifestKey(ctx.session.id));
      if (run?.status !== 'paused') await releaseComputer(ctx.session.id);
    },
    async 'turn.failed'(_event, ctx) {
      await releaseComputer(ctx.session.id);
    },
  },
});
