// Stockage éphémère : un fichier par job, purge automatique après TTL (§17.1).
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export const filesDir = config.storagePath;
export const tmpDir = path.join(config.storagePath, '..', 'tmp');

export async function initStorage() {
  await fs.mkdir(filesDir, { recursive: true });
  await fs.mkdir(tmpDir, { recursive: true });
  // Un redémarrage laisse des temporaires orphelins : on repart propre.
  await removeDirContents(tmpDir);
}

async function removeDirContents(dir) {
  const entries = await fs.readdir(dir).catch(() => []);
  await Promise.all(entries.map((name) => fs.rm(path.join(dir, name), { recursive: true, force: true })));
}

export function jobFilePath(jobId, extension) {
  return path.join(filesDir, `${jobId}${extension}`);
}

export function jobTmpDir(jobId) {
  return path.join(tmpDir, jobId);
}

export async function usedBytes() {
  const entries = await fs.readdir(filesDir, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const stat = await fs.stat(path.join(filesDir, entry.name)).catch(() => null);
    if (stat) total += stat.size;
  }
  return total;
}

export async function hasFreeSpace(estimatedBytes = 0) {
  const quota = config.storageQuotaMb * 1024 * 1024;
  const used = await usedBytes();
  return used + estimatedBytes <= quota;
}

export async function removeJobFiles(jobId) {
  await fs.rm(jobTmpDir(jobId), { recursive: true, force: true }).catch(() => {});
  const entries = await fs.readdir(filesDir).catch(() => []);
  await Promise.all(
    entries
      .filter((name) => name.startsWith(jobId))
      .map((name) => fs.rm(path.join(filesDir, name), { force: true }).catch(() => {})),
  );
}
