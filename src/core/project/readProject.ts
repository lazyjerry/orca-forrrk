import path from 'node:path';

import { listDirectory, readWorktreeTextFile } from '../git/fsRead';
import type { ProjectIdentity, ReadmeSummary } from '../git/types';

/** README 摘要只取這麼多字；面板是掃一眼的地方，不是閱讀器。 */
const SUMMARY_MAX_LENGTH = 220;
/** 大 README 不必整份讀進來。 */
const README_MAX_BYTES = 64 * 1024;

/** 依序找，先找到的算數。JSON 之外的格式只用正則抓幾個欄位，不引 TOML/YAML 解析器。 */
const MANIFESTS = ['package.json', 'pyproject.toml', 'Cargo.toml', 'composer.json', 'deno.json', 'go.mod'] as const;

export async function readProjectIdentity(repoRoot: string): Promise<ProjectIdentity | null> {
  for (const fileName of MANIFESTS) {
    const raw = await readWorktreeTextFile(path.join(repoRoot, fileName));
    if (raw === null) {
      continue;
    }
    const identity = parseManifest(fileName, raw);
    if (identity) {
      return { ...identity, license: identity.license ?? (await readLicense(repoRoot)) };
    }
  }

  const license = await readLicense(repoRoot);
  if (license) {
    return { name: null, version: null, description: null, source: 'LICENSE', license };
  }
  return null;
}

function parseManifest(fileName: string, raw: string): ProjectIdentity | null {
  if (fileName.endsWith('.json')) {
    return parseJsonManifest(fileName, raw);
  }
  if (fileName === 'go.mod') {
    const module = /^module\s+(\S+)/m.exec(raw)?.[1] ?? null;
    return module ? { name: module, version: null, description: null, source: fileName, license: null } : null;
  }
  // pyproject.toml 與 Cargo.toml 的欄位名稱一樣，只抓 name/version/description。
  return {
    name: tomlValue(raw, 'name'),
    version: tomlValue(raw, 'version'),
    description: tomlValue(raw, 'description'),
    source: fileName,
    license: tomlValue(raw, 'license'),
  };
}

function parseJsonManifest(fileName: string, raw: string): ProjectIdentity | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      name: stringOrNull(parsed.name),
      version: stringOrNull(parsed.version),
      description: stringOrNull(parsed.description),
      source: fileName,
      license: stringOrNull(parsed.license),
    };
  } catch {
    return null;
  }
}

function tomlValue(raw: string, key: string): string | null {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm').exec(raw);
  return match ? match[1] : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** LICENSE 的首行通常就是授權名稱（Apache License、MIT License…）。 */
async function readLicense(repoRoot: string): Promise<string | null> {
  for (const entry of await listDirectory(repoRoot)) {
    if (entry.isDirectory || !/^licen[cs]e(\.|$)/i.test(entry.name)) {
      continue;
    }
    const raw = await readWorktreeTextFile(path.join(repoRoot, entry.name));
    const firstLine = raw?.split(/\r?\n/).find((line) => line.trim() !== '')?.trim();
    if (firstLine) {
      return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
    }
  }
  return null;
}

export async function readReadme(repoRoot: string): Promise<ReadmeSummary | null> {
  const entries = await listDirectory(repoRoot);
  const fileName = entries
    .filter((entry) => !entry.isDirectory && /^readme(\.(md|markdown|txt|rst))?$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))[0];
  if (!fileName) {
    return null;
  }

  const raw = await readWorktreeTextFile(path.join(repoRoot, fileName));
  if (raw === null) {
    return null;
  }

  const text = raw.slice(0, README_MAX_BYTES);
  return {
    path: path.join(repoRoot, fileName),
    fileName,
    title: firstHeading(text),
    body: firstParagraph(text),
  };
}

function firstHeading(text: string): string | null {
  const match = /^#{1,3}\s+(.+)$/m.exec(text);
  return match ? stripMarkdown(match[1]) : null;
}

/** 跳過標題、徽章與引言區塊，取第一段真正的敘述。 */
function firstParagraph(text: string): string {
  const paragraphs = text.split(/\r?\n\s*\r?\n/);
  for (const block of paragraphs) {
    const line = block.trim();
    if (!line || line.startsWith('#') || line.startsWith('<') || line.startsWith('>')) {
      continue;
    }
    // 整段都是徽章連結的段落沒有閱讀價值。
    if (/^[[!]/.test(line) && !/[。．.]\s*$/.test(line)) {
      continue;
    }
    const flat = stripMarkdown(line.replace(/\s*\r?\n\s*/g, ' '));
    if (flat.length === 0) {
      continue;
    }
    return flat.length > SUMMARY_MAX_LENGTH ? `${flat.slice(0, SUMMARY_MAX_LENGTH)}…` : flat;
  }
  return '';
}

function stripMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
}
