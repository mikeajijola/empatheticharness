import test from "node:test";
import assert from "node:assert/strict";
import { assertToolSurface, withRateLimitRetry } from "../agent/lib/boundary";
const allowed = ["screen", "mouse", "keyboard"].map(name => ({ type: "function", name }));
test("effective surface permits exactly three environmental tools", () => {
  assert.deepEqual(assertToolSurface(allowed), ["keyboard", "mouse", "screen"]);
});
test("fails closed for extra, missing, duplicate and provider tools", () => {
  for (const name of ["bash", "read_file", "write_file", "web_fetch", "web_search", "todo", "agent", "connection_search", "Workflow", "final_output"]) {
    assert.throws(() => assertToolSurface([...allowed, { type: "function", name }]), /CAPABILITY_BOUNDARY/);
  }
  assert.throws(() => assertToolSurface(undefined));
  assert.throws(() => assertToolSurface(allowed.slice(1)));
  assert.throws(() => assertToolSurface([...allowed, allowed[0]]));
  assert.throws(() => assertToolSurface(allowed.map(t => ({ ...t, type: "provider" }))));
});

test("retries only rate-limited model transport with a bounded delay", async () => {
  let calls = 0; const waits: number[] = [];
  const result = await withRateLimitRetry(async () => { if (++calls < 3) throw { statusCode: 429 }; return "ok"; }, async ms => { waits.push(ms); });
  assert.equal(result, "ok"); assert.deepEqual(waits, [65000, 65000]);
  await assert.rejects(withRateLimitRetry(async () => { throw new Error("bad credentials"); }, async () => { throw new Error("must not wait"); }), /bad credentials/);
  calls = 0;
  await assert.rejects(withRateLimitRetry(async () => { calls++; throw new Error("Free tier requests on this model are rate-limited"); }, async () => {}), /rate-limited/);
  assert.equal(calls, 3);
});

test("cancelled model requests do not call or retry the provider", async () => {
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  let calls = 0;
  await assert.rejects(withRateLimitRetry(async () => { calls++; return "unexpected"; }, undefined, controller.signal), /cancelled/);
  assert.equal(calls, 0);
});
