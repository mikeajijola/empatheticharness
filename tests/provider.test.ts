import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { browserRuntime } from '../agent/lib/providers/browser-runtime.js';

async function broker(maxActions = 100, failOperation?: string) {
  const calls: unknown[][] = [];
  let listener: (req: EventEmitter, res: unknown) => void;
  let ready!: () => void;
  const listening = new Promise<void>(resolve => { ready = resolve; });
  const physical = (name: string) => async (...args: unknown[]) => {
    calls.push([name, ...args]);
    if (name === failOperation) throw new Error('Private browser details must not escape');
  };
  const page = {
    goto: physical('goto'), isClosed: () => false,
    screenshot: async () => Buffer.from('rendered PNG'),
    mouse: { move: physical('move'), click: physical('click'), wheel: physical('wheel') },
    keyboard: { insertText: physical('type'), press: physical('press'), down: physical('down'), up: physical('up') },
  };
  const context = { newPage: async () => page, on: () => undefined };
  runInNewContext(browserRuntime, {
    require: (module: string) => module === 'node:http'
      ? { createServer: (fn: typeof listener) => { listener = fn; return { listen: ready, on: () => undefined }; } }
      : { chromium: { launch: async () => ({ newContext: async () => context, isConnected: () => true }) } },
    process: { argv: ['', '', JSON.stringify({ initialUrl: 'https://example.com', maxActions })] },
    setTimeout: (fn: () => void) => { fn(); return 0; },
  });
  await listening;
  async function request(op: string, args: unknown[] = [], callId = 'call-1'): Promise<any> {
    return new Promise(resolve => {
      const req = new EventEmitter();
      listener(req, { setHeader: () => undefined, end: (json: string) => resolve(JSON.parse(json)) });
      req.emit('data', JSON.stringify({ op, args, callId }));
      req.emit('end');
    });
  }
  return { calls, request };
}

test('physical actions require a screenshot and replay exactly once', async () => {
  const { request, calls } = await broker();
  assert.equal((await request('click', [2, 3, 'left'])).error, 'SCREENSHOT_REQUIRED');
  const screen = await request('screenshot');
  assert.deepEqual(Object.keys(screen).sort(), ['base64', 'height', 'mediaType', 'width']);
  assert.equal(screen.width, 1024);
  assert.equal(screen.height, 640);
  assert.deepEqual(await request('click', [2, 3, 'left']), { ok: true });
  assert.deepEqual(await request('click', [2, 3, 'left']), { ok: true });
  assert.equal(calls.filter(call => call[0] === 'click').length, 1);
  assert.equal((await request('click', [3, 3, 'left'])).error, 'CALL_ID_CONFLICT');
  assert.equal((await request('type', ['hello'], 'call-2')).error, 'SCREENSHOT_REQUIRED');
});

test('rejects nonphysical commands, invalid coordinates, keys, and action overflow', async () => {
  const { request, calls } = await broker(1);
  await request('screenshot');
  for (const op of ['evaluate', 'goto', 'locator', 'fetch', 'snapshot', 'bash']) {
    assert.equal((await request(op)).error, 'UNKNOWN_OPERATION');
  }
  assert.equal((await request('click', [1280, 0, 'left'])).error, 'INVALID_INPUT');
  assert.equal((await request('pressKey', ['Control+L'])).error, 'INVALID_INPUT');
  assert.equal((await request('type', ['hi'], '')).error, 'INVALID_CALL_ID');
  assert.deepEqual(await request('type', ['hello']), { ok: true });
  await request('screenshot');
  assert.equal((await request('scroll', [0, 100], 'call-2')).error, 'LIMIT_REACHED');
  assert.deepEqual(calls.map(call => call[0]), ['goto', 'type']);
});

test('hotkeys release physical modifiers and input text stays opaque', async () => {
  const { request, calls } = await broker();
  await request('screenshot');
  await request('hotkey', [['Control', 'Shift', 'a']]);
  assert.deepEqual(calls.slice(1).map(call => call.slice(0, 2)), [
    ['down', 'Control'], ['down', 'Shift'], ['press', 'a'], ['up', 'Shift'], ['up', 'Control'],
  ]);
  await request('screenshot');
  const text = '`$(secret)`\n<script>alert(1)</script>';
  await request('type', [text], 'next-call');
  assert.deepEqual(calls.at(-1), ['type', text]);
});

test('concurrent retries serialize and uncertain input fails closed', async () => {
  const { request, calls } = await broker();
  await request('screenshot');
  const replies = await Promise.all([
    request('click', [10, 20, 'left']), request('click', [10, 20, 'left']),
  ]);
  assert.deepEqual(replies, [{ ok: true }, { ok: true }]);
  assert.equal(calls.filter(call => call[0] === 'click').length, 1);

  const broken = await broker(100, 'press');
  await broken.request('screenshot');
  assert.deepEqual(await broken.request('hotkey', [['Control', 'a']]), { error: 'ACTION_UNCERTAIN' });
  assert.deepEqual(broken.calls.at(-1), ['up', 'Control']);
  assert.deepEqual(await broken.request('hotkey', [['Control', 'a']]), { error: 'COMPUTER_UNAVAILABLE' });
  assert.deepEqual(await broken.request('screenshot'), { error: 'COMPUTER_UNAVAILABLE' });
});
