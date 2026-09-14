import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { reportStore, writeJson } from '../lib/report-store';
if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) throw new Error('Configure private Vercel Blob before archiving artifacts.');
const store = reportStore();
const files: { path: string; key: string }[] = [];
async function collect(directory: string, prefix: string) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const path = join(directory, entry.name), key = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await collect(path, key);
    else if (entry.isFile() && !entry.name.endsWith('.tmp') && path !== 'evidence/README.md') files.push({ path, key });
  }
}
await collect('evidence', 'archive/evidence');
await collect('.reports/runs', 'runs');
const results: { key: string; bytes: number; sha256: string }[] = [];
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < files.length) {
    const file = files[next++];
    const data = await readFile(file.path);
    await store.write(file.key, data);
    results.push({ key: file.key, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
  }
}));
await writeJson(store, 'archive/index.json', { archivedAt: new Date().toISOString(), files: results.sort((a, b) => a.key.localeCompare(b.key)) });
console.log(`Archived ${results.length} files (${results.reduce((n, file) => n + file.bytes, 0)} bytes) to private Blob storage.`);
