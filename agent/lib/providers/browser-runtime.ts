// This source runs only inside the VM. It intentionally has no DOM-reading API.
export const browserRuntime = String.raw`
const http = require('node:http');
const { chromium } = require('playwright');
const config = JSON.parse(process.argv[2]);
const socket = '/tmp/empatheticharness-computer.sock';
const width = 1024, height = 640;
const results = new Map();
let actions = 0, needsScreenshot = true, poisoned = false;
let queue = Promise.resolve();
let startupPhase = 'browser-launch';

async function main() {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: false });
  startupPhase = 'browser-context';
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  let page = await context.newPage();
  context.on('page', next => { page = next; });
  // This is the sole navigation API: an operator-configured starting page.
  startupPhase = 'initial-navigation';
  await page.goto(config.initialUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const coordinate = (x, y) => finite(x) && finite(y) && x >= 0 && y >= 0 && x < width && y < height;
  const key = value => typeof value === 'string' && (/^[a-zA-Z0-9]$/.test(value) || /^(Enter|Tab|Escape|Backspace|Delete|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Shift|Control|Alt|Meta|F[1-9]|F1[0-2])$/.test(value));

  async function dispatch(request) {
    if (poisoned || !browser.isConnected() || page.isClosed()) return { error: 'COMPUTER_UNAVAILABLE' };
    const { op, args = [], callId } = request;
    if (op === 'health') return { ok: true };
    if (op === 'screenshot') {
      const png = await page.screenshot({ type: 'png', fullPage: false, timeout: 10000 });
      needsScreenshot = false;
      return { base64: png.toString('base64'), mediaType: 'image/png', width, height };
    }
    if (typeof callId !== 'string' || !callId || callId.length > 512) return { error: 'INVALID_CALL_ID' };
    const id = callId + ':' + op;
    const signature = JSON.stringify(args);
    if (results.has(id)) {
      const cached = results.get(id);
      return cached.signature === signature ? cached.result : { error: 'CALL_ID_CONFLICT' };
    }
    if (needsScreenshot) return { error: 'SCREENSHOT_REQUIRED' };
    if (actions >= config.maxActions) return { error: 'LIMIT_REACHED' };
    let action;
    switch (op) {
      case 'moveMouse':
        if (!coordinate(args[0], args[1])) return { error: 'INVALID_INPUT' };
        action = () => page.mouse.move(args[0], args[1]); break;
      case 'click':
        if (!coordinate(args[0], args[1]) || !['left', 'right', 'middle'].includes(args[2])) return { error: 'INVALID_INPUT' };
        action = () => page.mouse.click(args[0], args[1], { button: args[2] }); break;
      case 'scroll':
        if (!args.every(n => finite(n) && Math.abs(n) <= 5000) || args.length !== 2) return { error: 'INVALID_INPUT' };
        action = () => page.mouse.wheel(args[0], args[1]); break;
      case 'type':
        if (typeof args[0] !== 'string' || args[0].length > 10000) return { error: 'INVALID_INPUT' };
        action = () => page.keyboard.insertText(args[0]); break;
      case 'pressKey':
        if (!key(args[0])) return { error: 'INVALID_INPUT' };
        action = () => page.keyboard.press(args[0]); break;
      case 'hotkey': {
        const keys = args[0];
        if (!Array.isArray(keys) || keys.length < 2 || keys.length > 4 || !keys.every(key)) return { error: 'INVALID_INPUT' };
        action = async () => {
          const held = [];
          try {
            for (const k of keys.slice(0, -1)) { await page.keyboard.down(k); held.push(k); }
            await page.keyboard.press(keys[keys.length - 1]);
          } finally {
            for (const k of held.reverse()) await page.keyboard.up(k);
          }
        };
        break;
      }
      default: return { error: 'UNKNOWN_OPERATION' };
    }
    // Record uncertainty before a non-idempotent action. Never retry a partial action.
    const record = { signature, result: { error: 'ACTION_UNCERTAIN' } };
    results.set(id, record);
    actions++;
    needsScreenshot = true;
    try {
      await action();
      await new Promise(resolve => setTimeout(resolve, 150));
      record.result = { ok: true };
    } catch { poisoned = true; }
    return record.result;
  }

  const server = http.createServer((req, res) => {
    let body = '', oversized = false;
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 65536) { oversized = true; req.destroy(); }
    });
    req.on('end', () => {
      if (oversized) return;
      queue = queue.then(async () => {
        let result;
        try { result = await dispatch(JSON.parse(body)); }
        catch { result = { error: 'COMPUTER_UNAVAILABLE' }; }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(result));
      });
    });
  });
  startupPhase = 'broker-listen';
  server.on('error', () => { console.error('COMPUTER_STARTUP_FAILED:broker-listen'); process.exit(1); });
  server.listen(socket);
}
main().catch(() => { console.error('COMPUTER_STARTUP_FAILED:' + startupPhase); process.exit(1); });
`;

// Only trusted host code supplies the fixed socket and serialized operation.
export const browserClient = String.raw`
const http = require('node:http');
const req = http.request({ socketPath: '/tmp/empatheticharness-computer.sock', path: '/', method: 'POST' }, res => {
  res.pipe(process.stdout);
});
req.setTimeout(20000, () => req.destroy());
req.on('error', () => { process.exitCode = 1; });
req.end(process.argv[1]);
`;
