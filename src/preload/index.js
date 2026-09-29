import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  openVaultDialog: () => ipcRenderer.invoke('dialog:openVault'),
  getLastVault: () => ipcRenderer.invoke('vault:getLast'),
  confirm: (msg) => ipcRenderer.invoke('dialog:confirm', msg),
  loadVault: (vaultPath) => ipcRenderer.invoke('vault:load', vaultPath),
  createFolder: (parentDir, name) => ipcRenderer.invoke('vault:createFolder', parentDir, name),
  createFile: (parentDir, name) => ipcRenderer.invoke('vault:createFile', parentDir, name),
  rename: (oldPath, newName) => ipcRenderer.invoke('vault:rename', oldPath, newName),
  moveNode: (srcPath, destDir) => ipcRenderer.invoke('vault:move', srcPath, destDir),
  delete: (targetPath) => ipcRenderer.invoke('vault:delete', targetPath),
  copyPath: (targetPath) => ipcRenderer.invoke('vault:copyPath', targetPath),
  showInFolder: (targetPath) => ipcRenderer.invoke('vault:showInFolder', targetPath),
  readFile: (filePath) => ipcRenderer.invoke('vault:readFile', filePath),
  gitStatus: () => ipcRenderer.invoke('git:status'),
  gitInit: () => ipcRenderer.invoke('git:init'),
  gitSetRemote: (url) => ipcRenderer.invoke('git:setRemote', url),
  gitCommit: (msg) => ipcRenderer.invoke('git:commit', msg),
  gitRestore: (filePath) => ipcRenderer.invoke('git:restore', filePath),
  gitPush: () => ipcRenderer.invoke('git:push'),
  gitPull: () => ipcRenderer.invoke('git:pull'),
  onVaultChanged: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('vault:changed', handler)
    return () => ipcRenderer.removeListener('vault:changed', handler)
  },
  onFileChanged: (cb) => {
    const handler = (_e, p) => cb(p)
    ipcRenderer.on('file:changed', handler)
    return () => ipcRenderer.removeListener('file:changed', handler)
  }
})
