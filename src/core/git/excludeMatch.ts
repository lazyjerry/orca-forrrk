// .git/info/exclude 的樣式比對。語法跟 .gitignore 同一套，這裡實作常用的那部分：
// 註解、! 反向、結尾 / 只匹配目錄、開頭或中間有 / 就從儲存庫根算起、* ? **。
// 沒實作的是跳脫字元與 [abc] 字元集（一律當成字面字元），這兩種在 info/exclude 幾乎不會出現。

export interface ExcludeRule {
  /** 原文，命中時要顯示給使用者看。 */
  line: string;
  negated: boolean;
  /** 樣式結尾是 /，只能匹配目錄。 */
  dirOnly: boolean;
  /** 樣式（去掉結尾斜線後）含 /，比對整條相對路徑；否則比對每一層的檔名。 */
  anchored: boolean;
  pattern: RegExp;
}

export function parseExcludeRules(text: string): ExcludeRule[] {
  const rules: ExcludeRule[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (line === '' || line.startsWith('#')) {
      continue;
    }

    let body = line;
    const negated = body.startsWith('!');
    if (negated) {
      body = body.slice(1);
    }
    const dirOnly = body.endsWith('/');
    if (dirOnly) {
      body = body.slice(0, -1);
    }
    const anchored = body.includes('/');
    if (body.startsWith('/')) {
      body = body.slice(1);
    }
    if (body === '') {
      continue;
    }

    rules.push({ line, negated, dirOnly, anchored, pattern: toPattern(body) });
  }

  return rules;
}

/**
 * 回傳命中的樣式原文，沒被排除則回 null。
 * gitignore 是「後面的蓋前面的」，所以要走完全部規則取最後一個命中的；最後命中的是 ! 就等於沒被排除。
 */
export function matchExclude(relativePath: string, rules: ExcludeRule[]): string | null {
  const candidates = withAncestors(relativePath);
  let hit: ExcludeRule | null = null;

  for (const rule of rules) {
    for (let index = 0; index < candidates.length; index += 1) {
      // 第 0 個是檔案本身，其餘都是它的上層目錄；上層目錄被排除，底下的檔案跟著被排除。
      if (rule.dirOnly && index === 0) {
        continue;
      }
      const candidate = candidates[index];
      const target = rule.anchored ? candidate : candidate.slice(candidate.lastIndexOf('/') + 1);
      if (rule.pattern.test(target)) {
        hit = rule;
        break;
      }
    }
  }

  return hit && !hit.negated ? hit.line : null;
}

/** 'a/b/c.txt' → ['a/b/c.txt', 'a/b', 'a']。 */
function withAncestors(relativePath: string): string[] {
  const segments = relativePath.split('/');
  const result: string[] = [];
  for (let length = segments.length; length > 0; length -= 1) {
    result.push(segments.slice(0, length).join('/'));
  }
  return result;
}

function toPattern(glob: string): RegExp {
  let source = '';

  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === '*') {
      if (glob[index + 1] === '*') {
        index += 1;
        // a/**/b 也要匹配 a/b，所以 **/ 連斜線一起吃掉。
        if (glob[index + 1] === '/') {
          index += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(character)) {
      source += `\\${character}`;
    } else {
      source += character;
    }
  }

  return new RegExp(`^${source}$`);
}
