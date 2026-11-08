import path from 'node:path';

// macOS 會把這些副檔名的資料夾當成單一 bundle／package，「開啟」它等於啟動或安裝，而不是看裡面的檔案。
const BUNDLE_EXTENSIONS = new Set([
  'app',
  'appex',
  'action',
  'bundle',
  'dext',
  'framework',
  'kext',
  'mdimporter',
  'mpkg',
  'pkg',
  'plugin',
  'prefpane',
  'qlgenerator',
  'saver',
  'scptd',
  'systemextension',
  'workflow',
  'xpc',
]);

export function isMacBundlePath(target: string): boolean {
  const extension = path.extname(target.replace(/[\\/]+$/, '')).slice(1).toLowerCase();
  return BUNDLE_EXTENSIONS.has(extension);
}
