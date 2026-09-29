import { app, BrowserWindow, ipcMain, dialog, clipboard, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import chokidar from 'chokidar'

const exec = promisify(execFile)

let mainWindow = null
let currentVault = null
let watcher = null

// ---------- 配置持久化 ----------
const configPath = path.join(app.getPath('userData'), 'config.json')
function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, 'utf-8')) }
  catch { return {} }
}
function writeConfig(cfg) {
  try { fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2)) } catch {}
}

// ---------- 文件工具 ----------
const shouldSkip = (name) => name.startsWith('.') || name === 'node_modules'

async function buildTree(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  const nodes = []
  for (const entry of entries) {
    if (shouldSkip(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: full,
        type: 'dir',
        children: await buildTree(full)
      })
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      nodes.push({ name: entry.name, path: full, type: 'file' })
    }
  }
  // 目录在前，文件在后，各自按名称排序
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}

// ---------- 文件监听 ----------
function stopWatching() {
  if (watcher) {
    watcher.close()
    watcher = null
  }
}

function startWatching(vaultPath) {
  stopWatching()
  watcher = chokidar.watch(vaultPath, {
    ignoreInitial: true,
    ignored: (p) => {
      const base = path.basename(p)
      return shouldSkip(base) || base === 'node_modules'
    },
    depth: 99
  })
  const reload = () => mainWindow?.webContents.send('vault:changed')
  watcher.on('add', reload)
  watcher.on('unlink', reload)
  watcher.on('addDir', reload)
  watcher.on('unlinkDir', reload)
  // 文件内容变化（外部 AI 写入）→ 通知当前预览刷新
  watcher.on('change', (p) => {
    mainWindow?.webContents.send('file:changed', p)
  })
}

// ---------- IPC ----------
ipcMain.handle('dialog:openVault', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:confirm', async (_, message) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    message,
    buttons: ['取消', '确定'],
    defaultId: 0,
    cancelId: 0
  })
  return result.response === 1
})

ipcMain.handle('vault:load', async (_, vaultPath) => {
  currentVault = vaultPath
  startWatching(vaultPath)
  // 记住上次打开
  const cfg = readConfig()
  cfg.lastVault = vaultPath
  writeConfig(cfg)
  const tree = await buildTree(vaultPath)
  return { root: vaultPath, tree, name: path.basename(vaultPath) }
})

ipcMain.handle('vault:getLast', () => readConfig().lastVault || null)

ipcMain.handle('vault:createFolder', async (_, parentDir, name) => {
  const target = path.join(parentDir, name)
  await fs.promises.mkdir(target, { recursive: true })
  return target
})

ipcMain.handle('vault:createFile', async (_, parentDir, name) => {
  const fileName = name.toLowerCase().endsWith('.html') ? name : `${name}.html`
  const target = path.join(parentDir, fileName)
  // 真正的空文件，不加骨架，由 AI 来写
  await fs.promises.writeFile(target, '', 'utf-8')
  return target
})

ipcMain.handle('vault:rename', async (_, oldPath, newName) => {
  const dir = path.dirname(oldPath)
  const target = path.join(dir, newName)
  await fs.promises.rename(oldPath, target)
  return target
})

ipcMain.handle('vault:move', async (_, srcPath, destDir) => {
  const name = path.basename(srcPath)
  const target = path.join(destDir, name)
  await fs.promises.rename(srcPath, target)
  return target
})

ipcMain.handle('vault:delete', async (_, targetPath) => {
  await fs.promises.rm(targetPath, { recursive: true, force: true })
})

ipcMain.handle('vault:copyPath', async (_, targetPath) => {
  clipboard.writeText(targetPath)
})

ipcMain.handle('vault:showInFolder', async (_, targetPath) => {
  const stat = await fs.promises.stat(targetPath)
  if (stat.isDirectory()) {
    await shell.openPath(targetPath)
  } else {
    shell.showItemInFolder(targetPath)
  }
})

// ---------- Git ----------
async function git(args) {
  const { stdout } = await exec('git', ['-c', 'core.quotepath=false', ...args], { cwd: currentVault, maxBuffer: 10 * 1024 * 1024 })
  return stdout.trim()
}

ipcMain.handle('git:status', async () => {
  if (!currentVault) return { isRepo: false }
  try {
    await git(['rev-parse', '--is-inside-work-tree'])
    let branch = ''
    try { branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']) }
    catch { branch = 'main' }
    const status = await git(['status', '--porcelain'])
    const remotes = await git(['remote', '-v'])
    const files = status ? status.split('\n').filter(Boolean).map(line => {
      const st = line.substring(0, 2).trim()
      const p = line.substring(2).trim()
      return { status: st, path: p }
    }) : []
    return {
      isRepo: true,
      branch,
      changed: files.length,
      remote: remotes ? remotes.split('\n')[0] : '',
      files
    }
  } catch {
    return { isRepo: false }
  }
})

ipcMain.handle('git:restore', async (_, filePath) => {
  await git(['checkout', '--', filePath])
})

ipcMain.handle('git:init', async () => {
  await git(['init'])
})

ipcMain.handle('git:setRemote', async (_, url) => {
  try { await git(['remote', 'remove', 'origin']) } catch {}
  await git(['remote', 'add', 'origin', url])
})

ipcMain.handle('git:commit', async (_, message) => {
  await git(['add', '-A'])
  try {
    await git(['commit', '-m', message || `update ${new Date().toLocaleString('zh-CN')}`])
  } catch (e) {
    // nothing to commit 不算错误
    if (!/nothing to commit/.test(e.message)) throw e
  }
})

ipcMain.handle('git:push', async () => {
  await git(['push', '-u', 'origin', 'HEAD'])
})

ipcMain.handle('git:pull', async () => {
  await git(['pull', '--rebase', 'origin', 'HEAD'])
})

ipcMain.handle('vault:readFile', async (_, filePath) => {
  return await fs.promises.readFile(filePath, 'utf-8')
})

// ---------- 窗口 ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'HTML 文档库',
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false // 允许 iframe 加载 file:// 资源
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopWatching()
  if (process.platform !== 'darwin') app.quit()
})
