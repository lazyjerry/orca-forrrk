import path from 'node:path';

import { MAC_CLI_RELATIVE_PATH } from './locateFork';

/** 提示使用者怎麼補齊缺少的東西，以及一段可直接貼進終端機的指令（沒有可靠指令時為 null）。 */
export interface ForkInstallHint {
  message: string;
  steps: string[];
  copyCommand: string | null;
}

/** 有 App 但沒有 CLI：先講官方途徑，再給等效的手動指令。 */
export function buildCliInstallHint(appPath: string, platform: NodeJS.Platform): ForkInstallHint {
  if (platform === 'darwin') {
    const cliPath = path.join(appPath, MAC_CLI_RELATIVE_PATH);
    return {
      message: 'forrrk：偵測到 Fork 應用程式，但找不到 fork 命令列工具。',
      steps: [
        '開啟 Fork，從選單列選 Fork → Install Command Line Tools。',
        '若該選項無法使用（多半是 /usr/local/bin 權限不足），改用下面的指令手動建立捷徑。',
        '裝好之後回到本面板按「刷新」，再按一次「在 Fork 中開啟」。',
      ],
      // 等同官方 fork_cli_install 做的事：建立 /usr/local/bin 再連過去。
      copyCommand: `sudo mkdir -p /usr/local/bin && sudo ln -sf "${cliPath}" /usr/local/bin/fork`,
    };
  }

  // Windows 版的命令列工具安裝路徑未經實機查證，寧可不給指令也不杜撰一段可能有害的命令。
  return {
    message: 'forrrk：偵測到 Fork 應用程式，但 fork 指令不在 PATH 中。',
    steps: [
      '開啟 Fork，在偏好設定中找到 command line tool 的安裝選項並啟用。',
      '重新開啟 Orca 讓新的 PATH 生效。',
      '回到本面板按「刷新」，再按一次「在 Fork 中開啟」。',
    ],
    copyCommand: null,
  };
}
