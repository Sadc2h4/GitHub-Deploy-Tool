const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Auth
  ghAuthStatus: () => ipcRenderer.invoke('gh-auth-status'),
  ghAuthLogout: () => ipcRenderer.invoke('gh-auth-logout'),
  ghAuthLogin: () => ipcRenderer.invoke('gh-auth-login'),
  ghAuthSetupGit: () => ipcRenderer.invoke('gh-auth-setup-git'),
  onAuthProgress: (cb) => {
    ipcRenderer.removeAllListeners('auth-progress');
    ipcRenderer.on('auth-progress', (_, data) => cb(data));
  },
  onAuthDeviceCode: (cb) => {
    ipcRenderer.removeAllListeners('auth-device-code');
    ipcRenderer.on('auth-device-code', (_, data) => cb(data));
  },
  checkEnvironment: () => ipcRenderer.invoke('check-environment'),

  // Repos
  ghRepoList: () => ipcRenderer.invoke('gh-repo-list'),
  ghRepoCreate: (data) => ipcRenderer.invoke('gh-repo-create', data),

  // Folder
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximizeState: (cb) => {
    ipcRenderer.removeAllListeners('window-maximize-state');
    ipcRenderer.on('window-maximize-state', (_, data) => cb(data));
  },
  windowClose: () => ipcRenderer.invoke('window-close'),

  // Git
  gitInitCheck: (data) => ipcRenderer.invoke('git-init-check', data),
  gitInit: (data) => ipcRenderer.invoke('git-init', data),
  gitSetRemote: (data) => ipcRenderer.invoke('git-set-remote', data),
  gitDeploy: (data) => ipcRenderer.invoke('git-deploy', data),
  gitDeploySelected: (data) => ipcRenderer.invoke('git-deploy-selected', data),
  gitConfig: (data) => ipcRenderer.invoke('git-config', data),
  onDeployProgress: (cb) => {
    ipcRenderer.removeAllListeners('deploy-progress');
    ipcRenderer.on('deploy-progress', (_, data) => cb(data));
  },

  // Files
  getFileList: (data) => ipcRenderer.invoke('get-file-list', data),
  checkGitignore: (data) => ipcRenderer.invoke('check-gitignore', data),
  saveGitignore: (data) => ipcRenderer.invoke('save-gitignore', data),
});
