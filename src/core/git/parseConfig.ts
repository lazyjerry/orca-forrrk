import type { GitConfigEntry } from './types';

// git config 的 INI 方言：subsection 要引號、值可跨行續接、引號內的 # 與 ; 不是註解。
// 自己寫是為了不引入相依，也因為現成的 ini 套件都不處理 [remote "origin"] 這種雙層 section。

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  b: '\b',
  '\\': '\\',
  '"': '"',
};

const SECTION_LINE = /^\[([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/;
const KEY_LINE = /^([A-Za-z][A-Za-z0-9-]*)\s*(=)?\s*([\s\S]*)$/;

export function parseGitConfig(text: string): GitConfigEntry[] {
  const entries: GitConfigEntry[] = [];
  const lines = text.split(/\r?\n/);

  let section = '';
  let subsection: string | undefined;
  let pending: { key: string; value: string } | null = null;

  for (const rawLine of lines) {
    // 續行中：整行都是值的一部分，不再當成 section 或 key。
    if (pending) {
      const { value, continues } = parseValue(rawLine);
      pending.value += value;
      if (continues) {
        continue;
      }
      if (section) {
        entries.push({ section, subsection, key: pending.key, value: pending.value });
      }
      pending = null;
      continue;
    }

    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }

    const sectionMatch = SECTION_LINE.exec(line);
    if (sectionMatch) {
      const parsed = parseSectionName(sectionMatch[1], sectionMatch[2]);
      section = parsed.section;
      subsection = parsed.subsection;
      continue;
    }

    const keyMatch = KEY_LINE.exec(line);
    if (!keyMatch || !section) {
      continue;
    }

    const key = keyMatch[1].toLowerCase();
    // 沒有等號的裸鍵在 git 裡等同布林 true（例如 bare 之於 [core]）。
    if (!keyMatch[2]) {
      entries.push({ section, subsection, key, value: 'true' });
      continue;
    }

    const { value, continues } = parseValue(keyMatch[3]);
    if (continues) {
      pending = { key, value };
      continue;
    }
    entries.push({ section, subsection, key, value });
  }

  // 檔案在續行途中結束：把已收到的部分留下，不整筆丟棄。
  if (pending && section) {
    entries.push({ section, subsection, key: pending.key, value: pending.value });
  }

  return entries;
}

function parseSectionName(name: string, quoted: string | undefined): { section: string; subsection?: string } {
  if (quoted !== undefined) {
    return { section: name.toLowerCase(), subsection: unescapeSubsection(quoted) };
  }

  // 舊式 [section.subsection] 寫法：第一個點之後全部是 subsection。
  const dot = name.indexOf('.');
  if (dot === -1) {
    return { section: name.toLowerCase() };
  }
  return { section: name.slice(0, dot).toLowerCase(), subsection: name.slice(dot + 1) };
}

function unescapeSubsection(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      out += raw[i + 1];
      i += 1;
      continue;
    }
    out += raw[i];
  }
  return out;
}

/**
 * 解析等號右側的值。continues 為 true 表示這行以反斜線結尾、值延續到下一行。
 * 尾端空白只在引號外才修掉，所以 "  " 這種刻意保留的空白值不會被吃掉。
 */
function parseValue(rest: string): { value: string; continues: boolean } {
  let out = '';
  let keepUntil = 0;
  let inQuote = false;
  let continues = false;
  let i = 0;

  while (i < rest.length) {
    const ch = rest[i];

    if (ch === '\\') {
      const next = rest[i + 1];
      if (next === undefined) {
        continues = true;
        break;
      }
      out += ESCAPES[next] ?? next;
      keepUntil = out.length;
      i += 2;
      continue;
    }

    if (ch === '"') {
      inQuote = !inQuote;
      i += 1;
      continue;
    }

    if (!inQuote && (ch === '#' || ch === ';')) {
      break;
    }

    out += ch;
    if (inQuote || !/\s/.test(ch)) {
      keepUntil = out.length;
    }
    i += 1;
  }

  // 續行代表值還沒結束，這時修掉尾端空白會把 `st = status \` 的分隔空白吃掉。
  return { value: continues ? out : out.slice(0, keepUntil), continues };
}
