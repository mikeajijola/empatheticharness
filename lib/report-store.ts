import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { get, list, put } from '@vercel/blob';

export interface ReportStore {
  read(key: string): Promise<Buffer | null>;
  write(key: string, data: Uint8Array | string): Promise<void>;
  create(key: string, data: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}
export function safeKey(key: string): string {
  if (!/^[a-zA-Z0-9_./-]+$/.test(key) || key.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid storage key');
  return key;
}
export function fileReportStore(directory: string): ReportStore {
  const root = resolve(directory);
  return {
    async read(key) {
      try { return await readFile(join(root, safeKey(key))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    },
    async write(key, data) {
      const target = join(root, safeKey(key));
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, data);
      await rename(temporary, target);
    },
    async create(key, data) {
      const target = join(root, safeKey(key)); await mkdir(dirname(target), { recursive: true });
      try { await writeFile(target, data, { flag: 'wx' }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    },
    async keys(prefix) {
      safeKey(prefix.replace(/\/$/, ''));
      const found: string[] = [];
      async function walk(directory: string, relative = ''): Promise<void> {
        let entries;
        try { entries = await readdir(directory, { withFileTypes: true }); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
        for (const entry of entries) {
          const key = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walk(join(directory, entry.name), key);
          else if (entry.isFile() && key.startsWith(prefix) && !key.endsWith('.tmp')) found.push(key);
        }
      }
      await walk(root);
      return found.sort();
    },
  };
}
const blobPrefix = 'simulator-reports/';
export function reportStore(): ReportStore {
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) return {
    async read(key) {
      const result = await get(blobPrefix + safeKey(key), { access: 'private', useCache: false });
      return result?.statusCode === 200 ? Buffer.from(await new Response(result.stream).arrayBuffer()) : null;
    },
    async write(key, data) {
      await put(blobPrefix + safeKey(key), typeof data === 'string' ? data : Buffer.from(data), {
        access: 'private', addRandomSuffix: false, allowOverwrite: true,
        contentType: key.endsWith('.pdf') ? 'application/pdf' : key.endsWith('.png') ? 'image/png' : key.endsWith('.ndjson') ? 'application/x-ndjson' : key.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8',
      });
    },
    async create(key, data) {
      try {
        await put(blobPrefix + safeKey(key), data, { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
      } catch (error) {
        // A concurrent event may already have created or completed this run.
        if (!await this.read(key)) throw error;
      }
    },
    async keys(prefix) {
      safeKey(prefix.replace(/\/$/, ''));
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: blobPrefix + prefix, cursor, limit: 1000 });
        keys.push(...page.blobs.map(blob => blob.pathname.slice(blobPrefix.length)));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return keys.sort();
    },
  };
  if (process.env.VERCEL) throw new Error('Connect a private Vercel Blob store before using chat reports.');
  return fileReportStore(process.env.REPORTS_DIRECTORY || '.reports');
}
export async function readJson<T>(store: ReportStore, key: string): Promise<T | null> {
  const bytes = await store.read(key);
  return bytes ? JSON.parse(bytes.toString('utf8')) as T : null;
}
export async function writeJson(store: ReportStore, key: string, value: unknown) {
  await store.write(key, JSON.stringify(value));
}
