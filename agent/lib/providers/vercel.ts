import { createHash } from 'node:crypto';
import { Sandbox } from '@vercel/sandbox';
import { defineState } from 'eve/context';
import type { Computer, ComputerOptions, Screenshot } from '../computer.js';
import { browserClient, browserRuntime } from './browser-runtime.js';

const binding = defineState('empatheticharness.computer', () => ({ name: '' }));
const directory = '/vercel/sandbox/computer';
const unavailable = () => new Error('COMPUTER_UNAVAILABLE: start a new session to provision a fresh computer.');

async function denyResume(sandbox: Sandbox) {
  await sandbox.stop().catch(() => undefined);
  throw unavailable();
}

async function stage<T>(name: string, run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch {
    // Operator logs contain fixed setup stages, never provider/page error text.
    console.error(JSON.stringify({ component: 'computer', stage: name, status: 'failed' }));
    throw unavailable();
  }
}

export function sandboxName(sessionId: string): string {
  if (!sessionId) throw new Error('A trusted session ID is required.');
  return `empatheticharness-${createHash('sha256').update(sessionId).digest('hex').slice(0, 40)}`;
}

export async function releaseVercelComputer(sessionId: string): Promise<void> {
  try {
    const sandbox = await Sandbox.get({
      ...credentials(), name: sandboxName(sessionId), resume: false, onResume: denyResume,
    });
    if (sandbox.status === 'running' || sandbox.status === 'pending') {
      await sandbox.stop();
    }
    console.info(JSON.stringify({ component: 'computer', stage: 'cleanup', status: 'stopped' }));
  } catch {
    // A cleanup failure must not replace the completed result or cascade failures.
    console.error(JSON.stringify({ component: 'computer', stage: 'cleanup', status: 'failed' }));
  }
}

function credentials() {
  const { VERCEL_TOKEN: token, VERCEL_TEAM_ID: teamId, VERCEL_PROJECT_ID: projectId } = process.env;
  return token && teamId && projectId ? { token, teamId, projectId } : {};
}

async function checked(sandbox: Sandbox, cmd: string, args: string[], cwd?: string) {
  const result = await sandbox.runCommand({ cmd, args, cwd });
  if (result.exitCode !== 0) throw unavailable();
  return result;
}

async function request(sandbox: Sandbox, op: string, args: unknown[] = [], callId?: string): Promise<unknown> {
  try {
    const result = await checked(sandbox, 'node', ['-e', browserClient, JSON.stringify({ op, args, callId })]);
    const response = JSON.parse(await result.stdout());
    if (response.error) {
      const allowed = ['SCREENSHOT_REQUIRED', 'LIMIT_REACHED', 'INVALID_INPUT', 'INVALID_CALL_ID', 'CALL_ID_CONFLICT', 'ACTION_UNCERTAIN'];
      throw new Error(allowed.includes(response.error) ? response.error : 'COMPUTER_UNAVAILABLE');
    }
    return response;
  } catch (error) {
    // Raw browser/SDK errors can contain URLs, source text or credentials.
    if (error instanceof Error && /^(SCREENSHOT_REQUIRED|LIMIT_REACHED|INVALID_INPUT|INVALID_CALL_ID|CALL_ID_CONFLICT|ACTION_UNCERTAIN)$/.test(error.message)) throw error;
    throw unavailable();
  }
}

async function bootstrap(sandbox: Sandbox, initialUrl: string, maxActions: number) {
  await stage('directory', () => checked(sandbox, 'mkdir', ['-p', directory]));
  await stage('system-dependencies', () => checked(sandbox, 'sudo', ['dnf', 'install', '-y', 'nss', 'nspr', 'atk', 'at-spi2-atk', 'at-spi2-core', 'libXcomposite', 'libXdamage', 'libXrandr', 'libXfixes', 'libXcursor', 'libXi', 'libXtst', 'libXScrnSaver', 'libXext', 'libxkbcommon', 'mesa-libgbm', 'libdrm', 'mesa-libGL', 'mesa-libEGL', 'cups-libs', 'alsa-lib', 'pango', 'cairo', 'gtk3', 'dbus-libs']));
  await stage('playwright-install', () => checked(sandbox, 'npm', ['install', '--no-audit', '--no-fund', '--save-exact', 'playwright@1.63.0'], directory));
  await stage('chromium-install', () => checked(sandbox, 'npx', ['playwright', 'install', 'chromium'], directory));
  await stage('broker-write', () => sandbox.writeFiles([{ path: `${directory}/server.cjs`, content: Buffer.from(browserRuntime) }]));
  const server = await stage('broker-start', () => sandbox.runCommand({ cmd: 'node', args: [`${directory}/server.cjs`, JSON.stringify({ initialUrl, maxActions })], cwd: directory, detached: true }));
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await request(sandbox, 'health'); return; } catch { /* browser starting */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const stopped = await sandbox.getCommand(server.cmdId).catch(() => undefined);
  const diagnostic = stopped && stopped.exitCode !== null ? await stopped.stderr().catch(() => '') : '';
  const phase = diagnostic.match(/^COMPUTER_STARTUP_FAILED:(browser-launch|browser-context|initial-navigation|broker-listen)$/m)?.[1] ?? 'broker-readiness';
  console.error(JSON.stringify({ component: 'computer', stage: phase, status: 'failed' }));
  throw unavailable();
}

export async function connectVercelComputer(sessionId: string, options: ComputerOptions): Promise<Computer> {
  const name = sandboxName(sessionId);
  let sandbox: Sandbox;
  try {
    if (binding.get().name) {
      if (binding.get().name !== name) throw unavailable();
      sandbox = await Sandbox.get({ ...credentials(), name, resume: false, onResume: denyResume });
    } else {
      const initialUrl = options.initialUrl ?? process.env.COMPUTER_INITIAL_URL;
      if (!initialUrl || !['https:', 'http:'].includes(new URL(initialUrl).protocol)) throw unavailable();
      const maxActions = Number(process.env.COMPUTER_MAX_ACTIONS ?? 100);
      if (!Number.isInteger(maxActions) || maxActions < 1 || maxActions > 1000) throw unavailable();
      sandbox = await Sandbox.getOrCreate({
        ...credentials(), name, runtime: 'node24', timeout: 30 * 60 * 1000,
        resume: false,
        onResume: denyResume,
        onCreate: async created => {
          try { await bootstrap(created, initialUrl, maxActions); }
          catch { await created.stop().catch(() => undefined); throw unavailable(); }
        },
      });
      binding.update(() => ({ name }));
    }
    // Never revive a dead browser into an apparently continuous interaction.
    if (sandbox.status !== 'running') throw unavailable();
    await request(sandbox, 'health');
  } catch { throw unavailable(); }

  const action = async (op: string, args: unknown[]) => {
    await request(sandbox, op, args, options.callId);
  };
  return {
    screenshot: async () => await request(sandbox, 'screenshot') as Screenshot,
    moveMouse: (x, y) => action('moveMouse', [x, y]),
    click: (x, y, button = 'left') => action('click', [x, y, button]),
    scroll: (dx, dy) => action('scroll', [dx, dy]),
    type: text => action('type', [text]),
    pressKey: key => action('pressKey', [key]),
    hotkey: keys => action('hotkey', [keys]),
  };
}
