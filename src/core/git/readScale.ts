import path from 'node:path';

import { fileSize, listDirectory, modifiedAt, readTextFile } from './fsRead';
import type { ScaleInfo } from './types';

/** 鬆散物件的目錄是兩位十六進位；掃到這麼多顆就停手，只為了給個量級。 */
const LOOSE_OBJECT_SCAN_LIMIT = 5000;
const LOOSE_DIRECTORY = /^[0-9a-f]{2}$/;

export async function readScale(gitDir: string, commonDir: string): Promise<ScaleInfo> {
  const [refs, packed, pack, loose, lastGitOperationAt] = await Promise.all([
    countLooseRefs(commonDir),
    countPackedRefs(commonDir),
    sumPackSize(commonDir),
    countLooseObjects(commonDir),
    modifiedAt(path.join(gitDir, 'index')),
  ]);

  return {
    branchCount: refs.branches + packed.branches,
    tagCount: refs.tags + packed.tags,
    packBytes: pack,
    looseObjectCount: loose,
    lastGitOperationAt,
  };
}

async function countLooseRefs(commonDir: string): Promise<{ branches: number; tags: number }> {
  const [branches, tags] = await Promise.all([
    countFilesRecursively(path.join(commonDir, 'refs', 'heads')),
    countFilesRecursively(path.join(commonDir, 'refs', 'tags')),
  ]);
  return { branches, tags };
}

async function countPackedRefs(commonDir: string): Promise<{ branches: number; tags: number }> {
  const raw = await readTextFile(path.join(commonDir, 'packed-refs'));
  if (!raw) {
    return { branches: 0, tags: 0 };
  }

  let branches = 0;
  let tags = 0;
  for (const line of raw.split(/\r?\n/)) {
    // ^ 開頭是 annotated tag 的解參考目標，不是另一個 tag。
    if (!line || line.startsWith('#') || line.startsWith('^')) {
      continue;
    }
    const ref = line.slice(line.indexOf(' ') + 1).trim();
    if (ref.startsWith('refs/heads/')) {
      branches += 1;
    } else if (ref.startsWith('refs/tags/')) {
      tags += 1;
    }
  }
  return { branches, tags };
}

async function countFilesRecursively(target: string): Promise<number> {
  const entries = await listDirectory(target);
  let total = 0;
  for (const entry of entries) {
    total += entry.isDirectory ? await countFilesRecursively(path.join(target, entry.name)) : 1;
  }
  return total;
}

async function sumPackSize(commonDir: string): Promise<number> {
  const packDir = path.join(commonDir, 'objects', 'pack');
  const entries = await listDirectory(packDir);
  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory || !entry.name.endsWith('.pack')) {
      continue;
    }
    total += await fileSize(path.join(packDir, entry.name));
  }
  return total;
}

async function countLooseObjects(commonDir: string): Promise<number> {
  const objectsDir = path.join(commonDir, 'objects');
  let total = 0;
  for (const entry of await listDirectory(objectsDir)) {
    if (!entry.isDirectory || !LOOSE_DIRECTORY.test(entry.name)) {
      continue;
    }
    total += (await listDirectory(path.join(objectsDir, entry.name))).length;
    if (total >= LOOSE_OBJECT_SCAN_LIMIT) {
      return total;
    }
  }
  return total;
}
