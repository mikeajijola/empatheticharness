import { setTimeout as delay } from "node:timers/promises";
export async function withRateLimitRetry<T>(call: () => PromiseLike<T>, wait?: (ms: number) => Promise<void>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try { return await call(); }
    catch (error) {
      const e = error as { statusCode?: number; name?: string; message?: string };
      const limited = e.statusCode === 429 || e.name?.includes("RateLimit") || e.message?.includes("Free tier requests on this model are rate-limited");
      if (!limited || attempt >= 2) throw error;
      console.info(JSON.stringify({ kind: "model-rate-limit-retry", attempt: attempt + 1, waitMs: 65_000 }));
      if (wait) await wait(65_000);
      else await delay(65_000, undefined, { signal });
    }
  }
}
