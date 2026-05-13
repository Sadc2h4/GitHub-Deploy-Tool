const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow;
let cachedGitExecutable = null;
let cachedGitBinDir = null;

const WINDOWS_GIT_CANDIDATES = [
  'C:\\Program Files\\Git\\cmd\\git.exe',
  'C:\\Program Files (x86)\\Git\\cmd\\git.exe'
];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hidden',
    backgroundColor: '#0d1117',
    show: false
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-maximize-state', { isMaximized: true });
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-maximize-state', { isMaximized: false });
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window-toggle-maximize', () => {
  if (!mainWindow) return { isMaximized: false };
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
  return { isMaximized: mainWindow.isMaximized() };
});

ipcMain.handle('window-is-maximized', () => {
  return { isMaximized: mainWindow ? mainWindow.isMaximized() : false };
});

ipcMain.handle('window-close', () => {
  if (mainWindow) mainWindow.close();
});

function findGitExecutable() {
  if (cachedGitExecutable !== null) return cachedGitExecutable;

  if (process.platform === 'win32') {
    const gitPath = WINDOWS_GIT_CANDIDATES.find(candidate => fs.existsSync(candidate));
    if (gitPath) {
      cachedGitExecutable = gitPath;
      cachedGitBinDir = path.dirname(gitPath);
      return cachedGitExecutable;
    }
  }

  cachedGitExecutable = 'git';
  cachedGitBinDir = null;
  return cachedGitExecutable;
}

function quoteCommandPath(commandPath) {
  return commandPath.includes(' ') ? `"${commandPath}"` : commandPath;
}

function normalizeCommand(command) {
  if (!/^git(\s|$)/.test(command)) return command;
  return command.replace(/^git(?=\s|$)/, quoteCommandPath(findGitExecutable()));
}

function getCommandEnv(extraEnv = {}) {
  findGitExecutable();
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH';
  const env = { ...process.env, ...extraEnv };
  const currentPath = env[pathKey] || '';

  return {
    ...env,
    ...(cachedGitBinDir ? { [pathKey]: `${cachedGitBinDir}${path.delimiter}${currentPath}` } : {}),
  };
}

// コマンド実行ヘルパー
function runCommand(command, cwd = null, extraOptions = {}) {
  return new Promise((resolve, reject) => {
    const { env, ...restOptions } = extraOptions;
    const options = {
      ...(cwd ? { cwd } : {}),
      ...restOptions,
      env: getCommandEnv(env)
    };
    exec(normalizeCommand(command), options, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error.message, stderr, stdout });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function formatCommandError(err) {
  return [err?.stderr, err?.stdout, err?.error]
    .map(value => (value || '').trim())
    .filter(Boolean)
    .join('\n');
}

function isWorkflowScopeError(detail) {
  return /without [`']?workflow[`']? scope/i.test(detail) ||
    /refusing to allow .* to create or update workflow/i.test(detail);
}

function createWorkflowScopeError(detail) {
  const message = [
    'GitHub の認証トークンに workflow 権限がないため、.github/workflows 配下の更新をプッシュできません。',
    'GitHub Desktop / OAuth App / Personal Access Token の認証を workflow スコープ付きで再設定するか、workflow ファイルを含まないコミットに分けてください。',
    detail
  ].filter(Boolean).join('\n');

  return { error: message, stderr: message, stdout: '' };
}

function hasJapaneseInName(filePath) {
  const baseName = path.basename(filePath);
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/.test(baseName);
}

function parseLines(output) {
  return (output || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function normalizeRepoListResponse(stdout) {
  const parsed = JSON.parse(stdout || '[]');
  const pages = Array.isArray(parsed) ? parsed : [parsed];
  const rawRepos = pages.flatMap(page => Array.isArray(page) ? page : []);
  const seen = new Set();

  return rawRepos
    .filter(repo => repo && repo.full_name && repo.html_url)
    .filter(repo => repo.permissions?.push || repo.permissions?.admin)
    .map(repo => ({
      name: repo.name,
      nameWithOwner: repo.full_name,
      url: repo.html_url,
      isPrivate: Boolean(repo.private),
      canPush: Boolean(repo.permissions?.push || repo.permissions?.admin),
      owner: repo.owner?.login || repo.full_name.split('/')[0],
    }))
    .filter(repo => {
      if (seen.has(repo.nameWithOwner)) return false;
      seen.add(repo.nameWithOwner);
      return true;
    });
}

async function isGitIgnored(folderPath, filePath) {
  try {
    await runCommand(`git check-ignore -- "${filePath}"`, folderPath);
    return true;
  } catch (_) {
    return false;
  }
}

async function checkCommandVersion(command) {
  try {
    const result = await runCommand(command);
    return { installed: true, output: (result.stdout || result.stderr || '').trim() };
  } catch (err) {
    return { installed: false, output: formatCommandError(err) };
  }
}

const PUSH_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GH_PROMPT_DISABLED: '1'
};

function isNonFastForwardError(detail) {
  return detail.includes('non-fast-forward') ||
    detail.includes('[rejected]') ||
    detail.includes('fetch first') ||
    detail.includes('failed to push some refs');
}

async function pushNormal(event, folderPath, branch) {
  await runCommand(
    `git push -u origin ${branch}`,
    folderPath,
    {
      timeout: 120000,
      env: PUSH_ENV
    }
  );
  event.sender.send('deploy-progress', '✅ 通常プッシュ完了');
}

async function remoteBranchExists(folderPath, branch) {
  let remoteResult;
  try {
    remoteResult = await runCommand(`git ls-remote --heads origin ${branch}`, folderPath);
  } catch (_) {
    return false;
  }

  const remoteLine = parseLines(remoteResult.stdout)[0];
  return Boolean(remoteLine);
}

async function fetchRemoteBranch(event, folderPath, branch) {
  if (!await remoteBranchExists(folderPath, branch)) {
    event.sender.send('deploy-progress', 'ℹ リモートブランチはまだありません。履歴取り込みをスキップします。');
    return false;
  }

  event.sender.send('deploy-progress', '📥 履歴保持モード: リモート履歴を取得中...');
  await runCommand(
    `git fetch origin ${branch}`,
    folderPath,
    {
      timeout: 120000,
      env: PUSH_ENV
    }
  );

  return true;
}

async function prepareBranchForDeploy(event, folderPath, branch, pushMode) {
  if (pushMode !== 'preserve') {
    event.sender.send('deploy-progress', `🌿 ブランチを ${branch} に設定中...`);
    try {
      const branchResult = await runCommand('git branch --show-current', folderPath);
      const currentBranch = branchResult.stdout.trim();
      if (currentBranch !== branch) {
        try {
          await runCommand(`git checkout ${branch}`, folderPath);
        } catch (_) {
          await runCommand(`git checkout -b ${branch}`, folderPath);
        }
      }
    } catch (_) {
      try { await runCommand(`git checkout -b ${branch}`, folderPath); } catch (_) {}
    }
    event.sender.send('deploy-progress', `🌿 ブランチ: ${branch}`);
    return;
  }

  const fetched = await fetchRemoteBranch(event, folderPath, branch);
  event.sender.send('deploy-progress', `🌿 ブランチを ${branch} に設定中...`);

  if (!fetched) {
    try {
      const branchResult = await runCommand('git branch --show-current', folderPath);
      const currentBranch = branchResult.stdout.trim();
      if (currentBranch !== branch) {
        try {
          await runCommand(`git checkout ${branch}`, folderPath);
        } catch (_) {
          await runCommand(`git checkout -b ${branch}`, folderPath);
        }
      }
    } catch (_) {
      try { await runCommand(`git checkout -b ${branch}`, folderPath); } catch (_) {}
    }
    event.sender.send('deploy-progress', `🌿 ブランチ: ${branch}`);
    return;
  }

  event.sender.send('deploy-progress', '🧭 リモート履歴を差分比較のベースに設定中...');
  await runCommand(`git symbolic-ref HEAD refs/heads/${branch}`, folderPath);
  await runCommand(`git reset --mixed origin/${branch}`, folderPath);
  await runCommand(`git branch --set-upstream-to=origin/${branch} ${branch}`, folderPath).catch(() => {});
  event.sender.send('deploy-progress', `🌿 ブランチ: ${branch}（origin/${branch} をベースに差分化）`);
}

async function rebaseOntoRemoteHistory(event, folderPath, branch) {
  if (!await fetchRemoteBranch(event, folderPath, branch)) {
    return false;
  }

  event.sender.send('deploy-progress', '🔀 更新されたリモート履歴の上にコミットを積み直し中...');
  try {
    const rebaseResult = await runCommand(
      `git rebase origin/${branch}`,
      folderPath,
      {
        timeout: 120000,
        env: PUSH_ENV
      }
    );
    const rebaseOutput = (rebaseResult.stdout || rebaseResult.stderr || '').trim();
    if (rebaseOutput) {
      event.sender.send('deploy-progress', rebaseOutput);
    }
    return true;
  } catch (rebaseErr) {
    await runCommand('git rebase --abort', folderPath).catch(() => {});
    const detail = formatCommandError(rebaseErr);
    throw {
      error: [
        'リモート履歴の取り込み中に競合しました。',
        '履歴保持モードでは強制上書きを行わないため、競合ファイルを確認してから再実行してください。',
        detail
      ].filter(Boolean).join('\n'),
      stderr: detail,
      stdout: ''
    };
  }
}

async function pushWithForceFallback(event, folderPath, branch, pushMode = 'force') {
  if (pushMode === 'preserve') {
    try {
      await pushNormal(event, folderPath, branch);
      return;
    } catch (pushErr) {
      const detail = formatCommandError(pushErr);

      if (isWorkflowScopeError(detail)) {
        throw createWorkflowScopeError(detail);
      }

      if (!isNonFastForwardError(detail)) {
        throw pushErr;
      }

      event.sender.send('deploy-progress', '⚠ push直前にリモートが更新されました。履歴を再取得して再試行します...');
      await rebaseOntoRemoteHistory(event, folderPath, branch);
      await pushNormal(event, folderPath, branch);
      return;
    }
  }

  try {
    await pushNormal(event, folderPath, branch);
    return;
  } catch (pushErr) {
    const detail = formatCommandError(pushErr);

    if (isWorkflowScopeError(detail)) {
      throw createWorkflowScopeError(detail);
    }

    if (!isNonFastForwardError(detail)) {
      throw pushErr;
    }

    event.sender.send('deploy-progress', '⚠ リモート履歴と競合しています。強制プッシュで上書きします...');
    try {
      await runCommand(
        `git push -u origin ${branch} --force`,
        folderPath,
        {
          timeout: 120000,
          env: PUSH_ENV
        }
      );
    } catch (forceErr) {
      const forceDetail = formatCommandError(forceErr);
      if (isWorkflowScopeError(forceDetail)) {
        throw createWorkflowScopeError(forceDetail);
      }
      throw forceErr;
    }
    event.sender.send('deploy-progress', '✅ 強制プッシュ完了');
  }
}

async function shouldPushExistingCommit(folderPath, branch) {
  const headResult = await runCommand('git rev-parse HEAD', folderPath);
  const localHead = headResult.stdout.trim();

  let remoteResult;
  try {
    remoteResult = await runCommand(`git ls-remote --heads origin ${branch}`, folderPath);
  } catch (_) {
    return true;
  }

  const remoteLine = parseLines(remoteResult.stdout)[0];
  if (!remoteLine) {
    return true;
  }

  const remoteHead = remoteLine.split(/\s+/)[0];
  return remoteHead !== localHead;
}

// gh auth status - 現在のアカウント確認
ipcMain.handle('gh-auth-status', async () => {
  try {
    const result = await runCommand('gh auth status');
    return { success: true, output: result.stdout + result.stderr };
  } catch (e) {
    return { success: false, output: e.stderr || e.error };
  }
});

// gh auth logout
ipcMain.handle('gh-auth-logout', async () => {
  try {
    await runCommand('gh auth logout --hostname github.com');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.error };
  }
});

// gh auth login - ブラウザ認証を起動
ipcMain.handle('gh-auth-login', async (event) => {
  return new Promise((resolve) => {
    const proc = spawn('gh', ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https'], {
      shell: true,
      env: getCommandEnv()
    });

    let output = '';
    let loginUrlOpened = false;

    function processAuthOutput(chunk) {
      const text = chunk.toString();
      output += text;
      event.sender.send('auth-progress', text);

      const urlMatch = text.match(/https:\/\/github\.com\/login\/device/);
      const codeMatch = text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/);
      const url = urlMatch ? urlMatch[0] : null;
      const code = codeMatch ? codeMatch[0] : null;

      if (url || code) {
        event.sender.send('auth-device-code', { url, code });
      }

      if (url && !loginUrlOpened) {
        loginUrlOpened = true;
        shell.openExternal(url).catch(() => {});
      }
    }

    proc.stdout.on('data', (data) => {
      processAuthOutput(data);
    });

    proc.stderr.on('data', (data) => {
      processAuthOutput(data);
    });

    proc.on('close', (code) => {
      resolve({ success: code === 0, output });
    });
  });
});

ipcMain.handle('gh-auth-setup-git', async () => {
  try {
    const result = await runCommand('gh auth setup-git');
    return { success: true, output: result.stdout + result.stderr };
  } catch (e) {
    return { success: false, error: formatCommandError(e) };
  }
});

ipcMain.handle('check-environment', async () => {
  const isPackagedApp = app.isPackaged;
  const [nodeCheck, npmCheck, gitCheck, ghCheck] = await Promise.all([
    isPackagedApp
      ? Promise.resolve({ installed: true, output: '配布版では Electron に同梱されるため不要です' })
      : checkCommandVersion('node --version'),
    isPackagedApp
      ? Promise.resolve({ installed: true, output: '配布版では使用しません' })
      : checkCommandVersion('npm --version'),
    checkCommandVersion('git --version'),
    checkCommandVersion('gh --version'),
  ]);
  const gitExecutable = findGitExecutable();
  if (gitCheck.installed) {
    gitCheck.output = `${gitCheck.output}\n使用Git: ${gitExecutable}`;
  }

  const electronInstalled = isPackagedApp || fs.existsSync(path.join(__dirname, 'node_modules', 'electron'));

  return {
    success: true,
    appLaunch: isPackagedApp ? 'GitHub Deploy Tool.exe' : 'npm start',
    startupFile: isPackagedApp ? 'GitHub Deploy Tool.exe' : '起動.bat',
    checks: [
      {
        id: 'node',
        name: 'Node.js',
        installed: nodeCheck.installed,
        output: nodeCheck.output,
        required: !isPackagedApp,
        url: 'https://nodejs.org/',
      },
      {
        id: 'npm',
        name: 'npm',
        installed: npmCheck.installed,
        output: npmCheck.output,
        required: !isPackagedApp,
        url: 'https://nodejs.org/',
      },
      {
        id: 'git',
        name: 'Git',
        installed: gitCheck.installed,
        output: gitCheck.output,
        required: true,
        url: 'https://git-scm.com/downloads',
      },
      {
        id: 'gh',
        name: 'GitHub CLI',
        installed: ghCheck.installed,
        output: ghCheck.output,
        required: true,
        url: 'https://cli.github.com/',
      },
      {
        id: 'electron',
        name: 'electron package',
        installed: electronInstalled,
        output: isPackagedApp
          ? '配布版 exe に同梱済みです'
          : (electronInstalled ? 'node_modules/electron が利用可能です' : 'npm install が必要です'),
        required: !isPackagedApp,
        url: 'https://www.npmjs.com/package/electron',
      },
    ],
  };
});

// リポジトリ一覧取得
ipcMain.handle('gh-repo-list', async () => {
  try {
    const result = await runCommand(
      'gh api --paginate --slurp "user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100"'
    );
    const repos = normalizeRepoListResponse(result.stdout);
    return { success: true, repos };
  } catch (e) {
    return { success: false, error: formatCommandError(e) };
  }
});

// リポジトリ作成
ipcMain.handle('gh-repo-create', async (_, { name, isPrivate }) => {
  try {
    const visibility = isPrivate ? '--private' : '--public';
    const result = await runCommand(`gh repo create ${name} ${visibility}`);
    return { success: true, output: result.stdout };
  } catch (e) {
    return { success: false, error: e.error || e.stderr };
  }
});

// ローカルフォルダ選択ダイアログ
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, path: result.filePaths[0] };
  }
  return { success: false };
});

// git初期化チェック
ipcMain.handle('git-init-check', async (_, { folderPath }) => {
  try {
    await runCommand('git status', folderPath);
    return { success: true, initialized: true };
  } catch (e) {
    return { success: true, initialized: false };
  }
});

// git init
ipcMain.handle('git-init', async (_, { folderPath }) => {
  try {
    await runCommand('git init', folderPath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.error };
  }
});

// git remote設定
ipcMain.handle('git-set-remote', async (_, { folderPath, repoUrl }) => {
  try {
    // 既存のremoteを確認
    try {
      await runCommand('git remote remove origin', folderPath);
    } catch (_) {}
    await runCommand(`git remote add origin ${repoUrl}`, folderPath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.error };
  }
});

// git add & commit & push
ipcMain.handle('git-deploy', async (event, { folderPath, commitMessage, branch }) => {
  try {
    event.sender.send('deploy-progress', '📦 ファイルをステージング中...');
    await runCommand('git add .', folderPath);

    event.sender.send('deploy-progress', '💬 コミット中...');
    await runCommand(`git commit -m "${commitMessage}"`, folderPath);

    event.sender.send('deploy-progress', `🚀 ${branch}ブランチへプッシュ中...`);
    await runCommand(`git push -u origin ${branch}`, folderPath);

    event.sender.send('deploy-progress', '✅ デプロイ完了！');
    return { success: true };
  } catch (e) {
    event.sender.send('deploy-progress', `❌ エラー: ${e.error || e.stderr}`);
    return { success: false, error: e.error || e.stderr };
  }
});

// git config設定
ipcMain.handle('git-config', async (_, { name, email }) => {
  try {
    await runCommand(`git config --global user.name "${name}"`);
    if (email) await runCommand(`git config --global user.email "${email}"`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.error };
  }
});

// フォルダ内ファイル一覧取得（1階層）
ipcMain.handle('get-file-list', async (_, { folderPath }) => {
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const files = entries.map(e => ({
      name: e.name,
      isDir: e.isDirectory(),
      isHidden: e.name.startsWith('.'),
      hasJapaneseName: hasJapaneseInName(e.name)
    }));
    return { success: true, files };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// .gitignoreの存在確認・内容取得
ipcMain.handle('check-gitignore', async (_, { folderPath }) => {
  const gitignorePath = path.join(folderPath, '.gitignore');
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    return { success: true, exists: true, content };
  } catch (e) {
    return { success: true, exists: false, content: '' };
  }
});

// .gitignoreの保存
ipcMain.handle('save-gitignore', async (_, { folderPath, content }) => {
  const gitignorePath = path.join(folderPath, '.gitignore');
  try {
    fs.writeFileSync(gitignorePath, content, 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 選択ファイルのみをステージング（git add）
ipcMain.handle('git-deploy-selected', async (event, { folderPath, selectedFiles, commitMessage, branch, pushMode = 'force' }) => {
  try {
    event.sender.send('deploy-progress', '🔐 GitHub認証をGitに連携中...');
    const setupGitResult = await runCommand('gh auth setup-git', folderPath).catch((err) => ({
      error: formatCommandError(err)
    }));
    if (setupGitResult.error) {
      event.sender.send('deploy-progress', `⚠ gh auth setup-git に失敗: ${setupGitResult.error}`);
      event.sender.send('deploy-progress', '⚠ このまま続行しますが、このPCの Git 認証設定によっては push で失敗します。');
    } else {
      event.sender.send('deploy-progress', '🔐 Git認証連携を確認しました');
    }

    // 1. git user設定（ローカル優先で確実に設定）
    event.sender.send('deploy-progress', '👤 Gitユーザー設定中...');
    try {
      const accountResult = await runCommand('gh api user --jq .login');
      const accountName = accountResult.stdout.trim() || 'deploy-user';
      // グローバルとローカル両方に設定
      await runCommand(`git config --global user.name "${accountName}"`, folderPath);
      await runCommand(`git config --global user.email "${accountName}@users.noreply.github.com"`, folderPath);
      await runCommand(`git config user.name "${accountName}"`, folderPath);
      await runCommand(`git config user.email "${accountName}@users.noreply.github.com"`, folderPath);
      // Windows改行コード設定
      await runCommand(`git config --global core.autocrlf true`, folderPath);
      event.sender.send('deploy-progress', `👤 ユーザー設定完了: ${accountName}`);
    } catch (_) {
      await runCommand(`git config user.name "deploy-user"`, folderPath);
      await runCommand(`git config user.email "deploy-user@users.noreply.github.com"`, folderPath);
      await runCommand(`git config --global core.autocrlf true`, folderPath);
    }

    // 2. ブランチ作成・履歴保持モードのベース設定（addより前に実施）
    await prepareBranchForDeploy(event, folderPath, branch, pushMode);

    // 3. インデックスのタイムスタンプキャッシュを強制更新（Windows で変更を見逃すことがある）
    try {
      await runCommand('git update-index --refresh', folderPath);
    } catch (_) {} // 変更がある場合も non-zero で終わるので無視

    // .gitignore はフロント側の表示だけでなく、実際の git 判定でも除外する
    const deployFiles = [];
    const ignoredDeployFiles = [];
    for (const file of selectedFiles) {
      if (file === '.git' || file.startsWith('.git/')) continue;
      if (await isGitIgnored(folderPath, file)) {
        ignoredDeployFiles.push(file);
      } else {
        deployFiles.push(file);
      }
    }

    if (ignoredDeployFiles.length > 0) {
      event.sender.send('deploy-progress', `🚫 .gitignore対象を除外: ${ignoredDeployFiles.length}件`);
      ignoredDeployFiles.slice(0, 10).forEach(file => {
        event.sender.send('deploy-progress', `  - ${file}`);
      });
      if (ignoredDeployFiles.length > 10) {
        event.sender.send('deploy-progress', `  ...ほか${ignoredDeployFiles.length - 10}件`);
      }
    }

    event.sender.send('deploy-progress', `📦 ${deployFiles.length}件のファイルをステージング中...`);

    for (const file of deployFiles) {
      try {
        const addResult = await runCommand(`git add -v -- "${file}"`, folderPath);
        const verboseOutput = addResult.stdout.trim();
        if (verboseOutput) {
          event.sender.send('deploy-progress', `  ✓ ${file}`);
        } else {
          event.sender.send('deploy-progress', `  ○ ${file} (変更なし・スキップ)`);
        }
      } catch (addErr) {
        event.sender.send('deploy-progress', `  ⚠ スキップ: ${file} (${addErr.stderr || addErr.stdout || addErr.error})`);
      }
    }

    // すでに追跡済みの ignore 対象は、ローカルファイルを残したままリポジトリから外す
    const trackedIgnoredResult = await runCommand('git ls-files -ci --exclude-standard', folderPath).catch(() => ({ stdout: '' }));
    const trackedIgnoredFiles = parseLines(trackedIgnoredResult.stdout)
      .filter(f => f !== '.git' && !f.startsWith('.git/'));

    if (trackedIgnoredFiles.length > 0) {
      event.sender.send('deploy-progress', `🚫 追跡済みの.gitignore対象をリポジトリから除外: ${trackedIgnoredFiles.length}件`);
    }

    for (const file of trackedIgnoredFiles) {
      try {
        await runCommand(`git rm -r --cached -- "${file}"`, folderPath);
        event.sender.send('deploy-progress', `  - ${file} (追跡解除)`);
      } catch (removeErr) {
        event.sender.send('deploy-progress', `  ⚠ 追跡解除に失敗: ${file} (${removeErr.stderr || removeErr.stdout || removeErr.error})`);
      }
    }

    // 追跡済みファイルがローカルから削除されている場合は、削除も変更としてステージする
    const deletedResult = await runCommand('git ls-files --deleted', folderPath).catch(() => ({ stdout: '' }));
    const deletedTrackedFiles = parseLines(deletedResult.stdout)
      .filter(f => f !== '.git' && !f.startsWith('.git/'))
      .filter(f => !hasJapaneseInName(f));

    if (deletedTrackedFiles.length > 0) {
      event.sender.send('deploy-progress', `🗑 ${deletedTrackedFiles.length}件の削除をステージング中...`);
    }

    for (const file of deletedTrackedFiles) {
      try {
        await runCommand(`git add -A -- "${file}"`, folderPath);
        event.sender.send('deploy-progress', `  ✗ ${file} (削除を反映)`);
      } catch (deleteErr) {
        event.sender.send('deploy-progress', `  ⚠ 削除反映に失敗: ${file} (${deleteErr.stderr || deleteErr.stdout || deleteErr.error})`);
      }
    }

    // 4. ステージング確認
    const diffResult = await runCommand('git diff --cached --name-status', folderPath);
    const stagedFiles = parseLines(diffResult.stdout);
    event.sender.send('deploy-progress', `📋 ステージング済み変更: ${stagedFiles.length}件`);

    if (stagedFiles.length === 0) {
      // 新規変更なし → ローカルに未プッシュのコミットがあればプッシュを試みる
      event.sender.send('deploy-progress', '📋 新規変更なし。既存コミットのプッシュ要否を確認します...');

      let hasHead = false;
      try {
        await runCommand('git rev-parse HEAD', folderPath);
        hasHead = true;
      } catch (_) {}

      if (!hasHead) {
        event.sender.send('deploy-progress', '⚠ コミット済みの内容がありません。ファイルを変更してから再試行してください。');
        return { success: false, error: 'コミット済みの内容がありません' };
      }

      const needsPush = await shouldPushExistingCommit(folderPath, branch);
      if (!needsPush) {
        event.sender.send('deploy-progress', 'ℹ リモートは最新です。反映すべき新しい変更はありません。');
        return { success: true };
      }

      event.sender.send('deploy-progress', `🚀 ${branch}ブランチへプッシュ中...`);
      await pushWithForceFallback(event, folderPath, branch, pushMode);
      return { success: true };
    }

    // 5. コミット
    event.sender.send('deploy-progress', `💬 ${stagedFiles.length}件をコミット中...`);
    let commitResult;
    try {
      commitResult = await runCommand(`git commit -m "${commitMessage}"`, folderPath);
      event.sender.send('deploy-progress', commitResult.stdout.trim() || 'コミット完了');
    } catch (commitErr) {
      const detail = formatCommandError(commitErr) || 'git commit が失敗しました';
      event.sender.send('deploy-progress', `❌ コミット失敗: ${detail}`);
      const nameCheck = await runCommand('git config user.name', folderPath).catch(() => ({stdout:''}));
      const emailCheck = await runCommand('git config user.email', folderPath).catch(() => ({stdout:''}));
      const statusCheck = await runCommand('git status --short --branch', folderPath).catch(() => ({stdout:''}));
      const stagedCheck = await runCommand('git diff --cached --stat', folderPath).catch(() => ({stdout:''}));
      event.sender.send('deploy-progress', `🔍 user.name=${nameCheck.stdout.trim()} / user.email=${emailCheck.stdout.trim()}`);
      if (statusCheck.stdout.trim()) {
        event.sender.send('deploy-progress', `🔍 status:\n${statusCheck.stdout.trim()}`);
      }
      if (stagedCheck.stdout.trim()) {
        event.sender.send('deploy-progress', `🔍 staged:\n${stagedCheck.stdout.trim()}`);
      }
      return { success: false, error: detail };
    }

    // 6. プッシュ
    event.sender.send('deploy-progress', `🚀 ${branch}ブランチへプッシュ中...`);
    await pushWithForceFallback(event, folderPath, branch, pushMode);

    event.sender.send('deploy-progress', '✅ デプロイ完了！');
    return { success: true };
  } catch (e) {
    const errMsg = formatCommandError(e) || JSON.stringify(e);
    event.sender.send('deploy-progress', `❌ エラー詳細: ${errMsg}`);
    return { success: false, error: errMsg };
  }
});
