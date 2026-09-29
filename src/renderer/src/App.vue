<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import TreeNode from './TreeNode.vue'

const vault = ref(null)
const tree = ref([])
const openTabs = ref([])
const activePath = ref(null)
const expanded = reactive({}) // path -> true

const contextMenu = ref({ visible: false, x: 0, y: 0, node: null, isRoot: false })
const iframeKey = ref(0)
const git = ref({ isRepo: false, branch: '', changed: 0, remote: '', files: [] })
const gitBusy = ref(false)
const commitDlg = ref({ visible: false })
const toast = ref({ visible: false, msg: '' })
let toastTimer = null
function showToast(msg) {
  toast.value = { visible: true, msg }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.value.visible = false, 3000)
}

// Tab 右键菜单
const tabMenu = ref({ visible: false, x: 0, y: 0, path: null })
function showTabMenu(e, path) {
  e.preventDefault()
  tabMenu.value = { visible: true, x: e.clientX, y: e.clientY, path }
}
function closeAllTabs() {
  tabMenu.value.visible = false
  openTabs.value = []
  activePath.value = null
}

// 内联输入对话框
const inputDlg = ref({ visible: false, title: '', label: '', defaultValue: '', value: '' })
let inputResolver = null
function showInputDialog({ title, label, defaultValue = '' }) {
  inputDlg.value = { visible: true, title, label, defaultValue, value: defaultValue }
  return new Promise(resolve => { inputResolver = resolve })
}
function submitInput() {
  const v = inputDlg.value.value.trim()
  inputDlg.value.visible = false
  inputResolver?.(v || null)
}
function cancelInput() {
  inputDlg.value.visible = false
  inputResolver?.(null)
}

let offVaultChanged = null
let offFileChanged = null

async function openVault() {
  const p = await window.api.openVaultDialog()
  if (!p) return
  await loadVault(p)
}

async function loadVault(p) {
  const data = await window.api.loadVault(p)
  vault.value = { root: data.root, name: data.name }
  tree.value = data.tree
  expanded[data.root] = true
  refreshGit()
}

async function refreshTree() {
  if (!vault.value) return
  const data = await window.api.loadVault(vault.value.root)
  tree.value = data.tree
  refreshGit()
}

function toggleDir(node) {
  expanded[node.path] = !expanded[node.path]
}

async function openFile(node) {
  if (!openTabs.value.find(t => t.path === node.path)) {
    const content = await window.api.readFile(node.path)
    openTabs.value.push({ path: node.path, name: node.name, content })
  }
  activePath.value = node.path
}

function closeTab(path) {
  const idx = openTabs.value.findIndex(t => t.path === path)
  openTabs.value = openTabs.value.filter(t => t.path !== path)
  if (activePath.value === path) {
    activePath.value = openTabs.value[idx]?.path ?? openTabs.value[idx - 1]?.path ?? null
  }
}

const activeTab = () => openTabs.value.find(t => t.path === activePath.value)

// ---------- 右键菜单 ----------
function showMenu(e, node, isRoot = false) {
  e.preventDefault()
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY, node, isRoot }
}
function closeMenu() { contextMenu.value.visible = false }

function targetDir() {
  if (contextMenu.value.isRoot) return vault.value.root
  const n = contextMenu.value.node
  return n.type === 'dir' ? n.path : vault.value.root
}

async function createFolder() {
  closeMenu()
  const name = await showInputDialog({ title: '新建文件夹', label: '文件夹名称' })
  if (!name) return
  await window.api.createFolder(targetDir(), name)
}

async function createFile() {
  closeMenu()
  const name = await showInputDialog({ title: '新建 HTML 文档', label: '文档名称（.html 可省略）' })
  if (!name) return
  await window.api.createFile(targetDir(), name)
}

async function renameNode() {
  closeMenu()
  const n = contextMenu.value.node
  const name = await showInputDialog({ title: '重命名', label: '新名称', defaultValue: n.name })
  if (!name || name === n.name) return
  await window.api.rename(n.path, name)
}

async function deleteNode() {
  closeMenu()
  const n = contextMenu.value.node
  const ok = await window.api.confirm(`确定删除「${n.name}」？${n.type === 'dir' ? '（含全部内容）' : ''}`)
  if (!ok) return
  if (n.type === 'file') closeTab(n.path)
  await window.api.delete(n.path)
}

async function copyPath() {
  closeMenu()
  await window.api.copyPath(contextMenu.value.node.path)
}

async function showInFinder() {
  closeMenu()
  await window.api.showInFolder(contextMenu.value.node.path)
}

async function handleDrop(data, destDir) {
  if (!data || !data.path) return
  try {
    await window.api.moveNode(data.path, destDir)
    // 如果移动的是打开的文件，关掉旧标签（路径变了）
    closeTab(data.path)
  } catch (e) {
    showToast('移动失败：' + e.message)
  }
}

async function handleFileChanged(changedPath) {
  if (changedPath === activePath.value) {
    const content = await window.api.readFile(changedPath)
    const tab = openTabs.value.find(t => t.path === changedPath)
    if (tab) tab.content = content
    iframeKey.value++
  }
  refreshGit()
}

async function refreshGit() {
  if (!vault.value) return
  git.value = await window.api.gitStatus()
}

async function gitInit() {
  gitBusy.value = true
  try {
    await window.api.gitInit()
    const url = await showInputDialog({ title: '设置远程仓库', label: '远程仓库 URL（可稍后设置）' })
    if (url) await window.api.gitSetRemote(url)
    await refreshGit()
  } catch (e) { showToast('Git 初始化失败：' + e.message) }
  gitBusy.value = false
}

async function gitCommit() {
  // 先展示变更文件
  commitDlg.value.visible = true
}

async function confirmCommit() {
  gitBusy.value = true
  commitDlg.value.visible = false
  try {
    await window.api.gitCommit()
    await refreshGit()
    showToast('已提交')
  } catch (e) { showToast('提交失败：' + e.message) }
  gitBusy.value = false
}

async function restoreFile(filePath) {
  try {
    await window.api.gitRestore(filePath)
    await refreshGit()
    await refreshTree()
    showToast('已还原 ' + filePath)
  } catch (e) { showToast('还原失败：' + e.message) }
}

async function gitPush() {
  gitBusy.value = true
  try {
    await window.api.gitPush()
    showToast('已推送')
  } catch (e) { showToast('推送失败：' + e.message) }
  gitBusy.value = false
}

async function gitPull() {
  gitBusy.value = true
  try {
    await window.api.gitPull()
    await refreshTree()
    showToast('已拉取')
  } catch (e) { showToast('拉取失败：' + e.message) }
  gitBusy.value = false
}

async function gitSetRemote() {
  const url = await showInputDialog({ title: '设置远程仓库', label: '远程仓库 URL', defaultValue: git.value.remote.split(/\s/)[1] || '' })
  if (!url) return
  try {
    await window.api.gitSetRemote(url)
    await refreshGit()
    showToast('远程仓库已设置')
  } catch (e) { showToast('设置失败：' + e.message) }
}

onMounted(async () => {
  offVaultChanged = window.api.onVaultChanged(refreshTree)
  offFileChanged = window.api.onFileChanged(handleFileChanged)
  window.addEventListener('click', () => { closeMenu(); tabMenu.value.visible = false })
  // 自动恢复上次打开的文档库
  const last = await window.api.getLastVault()
  if (last) {
    try { await loadVault(last) } catch {}
  }
})
onBeforeUnmount(() => {
  offVaultChanged?.()
  offFileChanged?.()
})
</script>

<template>
  <div class="layout" @click="closeMenu">
    <div v-if="!vault" class="empty">
      <div class="empty-inner">
        <h1>HTML 文档库</h1>
        <p>选择一个文件夹作为你的文档库</p>
        <button class="primary" @click="openVault">打开文档库</button>
      </div>
    </div>

    <template v-else>
      <aside class="sidebar">
        <div class="sidebar-header">
          <span class="vault-name">
            <svg class="vault-icon" viewBox="0 0 16 16" width="14" height="14">
              <path d="M1.5 3.5a1 1 0 0 1 1-1h3.3a1 1 0 0 1 .8.4L7.2 4h6.3a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-9z"
                fill="none" stroke="currentColor" stroke-width="1"/>
            </svg>
            {{ vault.name }}
          </span>
          <button title="切换文档库" @click="openVault">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2.5 6h9l-2-2M13.5 10h-9l2 2"/>
            </svg>
          </button>
        </div>
        <div class="tree" @contextmenu="showMenu($event, null, true)">
          <TreeNode
            v-for="node in tree"
            :key="node.path"
            :node="node"
            :expanded="expanded"
            :active-path="activePath"
            @toggle="toggleDir"
            @open="openFile"
            @menu="showMenu"
            @drop="handleDrop"
          />
        </div>

        <!-- Git 状态栏 -->
        <div class="git-bar">
          <template v-if="git.isRepo">
            <button class="git-branch" @click="gitSetRemote" title="点击设置远程仓库">
              ⎇ {{ git.branch }}
              <span v-if="git.changed" class="git-dot">{{ git.changed }}</span>
            </button>
            <button :disabled="gitBusy || !git.changed" title="提交" @click="gitCommit">✓ 提交</button>
            <button :disabled="gitBusy" title="推送" @click="gitPush">↑ 推送</button>
            <button :disabled="gitBusy" title="拉取" @click="gitPull">↓ 拉取</button>
          </template>
          <button v-else class="git-init" :disabled="gitBusy" @click="gitInit">初始化 Git 仓库</button>
        </div>
      </aside>

      <main class="main">
        <div v-if="openTabs.length" class="tabs">
          <div
            v-for="tab in openTabs"
            :key="tab.path"
            class="tab"
            :class="{ active: tab.path === activePath }"
            @click="activePath = tab.path"
            @contextmenu="showTabMenu($event, tab.path)"
          >
            <span class="tab-name">{{ tab.name }}</span>
            <span class="tab-close" @click.stop="closeTab(tab.path)">✕</span>
          </div>
        </div>

        <div class="preview">
          <iframe
            v-if="activeTab()"
            :key="activeTab().path + '-' + iframeKey"
            :srcdoc="activeTab().content"
          ></iframe>
          <div v-else class="preview-empty">
            <p>从左侧选择一个 HTML 文档打开</p>
            <p class="dim">右键文件或文件夹可新建、复制路径</p>
          </div>
        </div>
      </main>
    </template>

    <div
      v-if="contextMenu.visible"
      class="menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.stop
    >
      <template v-if="contextMenu.isRoot || contextMenu.node?.type === 'dir'">
        <div class="menu-item" @click="createFolder">新建文件夹</div>
        <div class="menu-item" @click="createFile">新建 HTML 文档</div>
        <div class="menu-sep"></div>
      </template>
      <template v-if="!contextMenu.isRoot">
        <div class="menu-item" @click="copyPath">复制绝对路径</div>
        <div class="menu-item" @click="showInFinder">
          {{ contextMenu.node?.type === 'dir' ? '在 Finder 中打开' : '在 Finder 中显示' }}
        </div>
        <div class="menu-sep"></div>
        <div class="menu-item" @click="renameNode">重命名</div>
        <div class="menu-item danger" @click="deleteNode">删除</div>
      </template>
    </div>

    <!-- 输入对话框 -->
    <div v-if="inputDlg.visible" class="overlay" @click.self="cancelInput">
      <div class="dialog">
        <h3>{{ inputDlg.title }}</h3>
        <label>{{ inputDlg.label }}</label>
        <input
          ref="inputEl"
          v-model="inputDlg.value"
          @keyup.enter="submitInput"
          @keyup.esc="cancelInput"
          autofocus
        />
        <div class="dialog-btns">
          <button @click="cancelInput">取消</button>
          <button class="primary" @click="submitInput">确定</button>
        </div>
      </div>
    </div>

    <!-- Toast 提示 -->
    <div v-if="toast.visible" class="toast">{{ toast.msg }}</div>

    <!-- Tab 右键菜单 -->
    <div
      v-if="tabMenu.visible"
      class="menu"
      :style="{ left: tabMenu.x + 'px', top: tabMenu.y + 'px' }"
      @click.stop
    >
      <div class="menu-item" @click="closeTab(tabMenu.path); tabMenu.visible = false">关闭当前</div>
      <div class="menu-item" @click="closeAllTabs">关闭所有</div>
    </div>

    <!-- 提交前变更文件对话框 -->
    <div v-if="commitDlg.visible" class="overlay" @click.self="commitDlg.visible = false">
      <div class="dialog commit-dialog">
        <h3>提交变更（{{ git.files.length }} 个文件）</h3>
        <div class="file-list">
          <div v-for="f in git.files" :key="f.path" class="file-item">
            <span class="file-status" :class="f.status">{{ f.status }}</span>
            <span class="file-path">{{ f.path }}</span>
            <button class="restore-btn" @click="restoreFile(f.path)" title="还原此文件">还原</button>
          </div>
          <div v-if="!git.files.length" class="dim">没有变更</div>
        </div>
        <div class="dialog-btns">
          <button @click="commitDlg.visible = false">取消</button>
          <button class="primary" :disabled="!git.files.length" @click="confirmCommit">确认提交</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout { display: flex; height: 100%; }

.empty { flex: 1; display: flex; align-items: center; justify-content: center; }
.empty-inner { text-align: center; }
.empty-inner h1 { font-size: 24px; margin-bottom: 12px; }
.empty-inner p { color: var(--text-dim); margin-bottom: 20px; }
button.primary {
  background: var(--accent); color: #fff;
  padding: 8px 20px; border-radius: 6px; font-weight: 600;
}

.sidebar {
  width: 260px; min-width: 200px;
  background: var(--bg-sidebar); border-right: 1px solid var(--border);
  display: flex; flex-direction: column;
}
.sidebar-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border-bottom: 1px solid var(--border);
}
.vault-name { font-weight: 600; display: flex; align-items: center; gap: 6px; }
.vault-icon { color: var(--text-dim); }
.tree { flex: 1; overflow-y: auto; padding: 4px 0; }

.git-bar {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 8px; border-top: 1px solid var(--border);
  font-size: 11px; flex-wrap: nowrap; overflow: hidden;
}
.git-bar button {
  padding: 3px 6px; border-radius: 4px;
  border: 1px solid var(--border); background: #fff;
  white-space: nowrap; flex-shrink: 0; font-size: 11px;
}
.git-bar button:disabled { opacity: 0.4; cursor: not-allowed; }
.git-branch { display: flex; align-items: center; gap: 4px; font-weight: 600; }
.git-dot {
  background: var(--accent); color: #fff;
  border-radius: 10px; padding: 0 5px; font-size: 10px;
}
.git-init { width: 100%; justify-content: center; color: var(--accent); }

.main { flex: 1; display: flex; flex-direction: column; }
.tabs {
  display: flex; background: var(--bg-tab);
  border-bottom: 1px solid var(--border); overflow-x: auto;
}
.tab {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-right: 1px solid var(--border);
  background: var(--bg-tab); white-space: nowrap; cursor: pointer;
}
.tab.active { background: var(--bg-tab-active); }
.tab-close { color: var(--text-dim); padding: 0 2px; }
.tab-close:hover { color: var(--text); }

.preview { flex: 1; position: relative; background: #fff; }
.preview iframe { width: 100%; height: 100%; border: none; background: #fff; }
.preview-empty {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 8px;
  color: var(--text-dim); background: var(--bg);
}
.dim { opacity: 0.6; }

.menu {
  position: fixed; background: #ffffff;
  border: 1px solid var(--border); border-radius: 6px;
  padding: 4px; min-width: 160px; z-index: 9999;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
}
.menu-item { padding: 6px 12px; border-radius: 4px; cursor: pointer; }
.menu-item:hover { background: var(--bg-hover); }
.menu-item.danger { color: var(--danger); }
.menu-sep { height: 1px; background: var(--border); margin: 4px 0; }

.overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.3);
  display: flex; align-items: center; justify-content: center; z-index: 10000;
}
.dialog {
  background: #fff; border-radius: 10px; padding: 20px;
  width: 360px; box-shadow: 0 8px 32px rgba(0,0,0,0.2);
}
.dialog h3 { margin-bottom: 12px; font-size: 15px; }
.dialog label { display: block; font-size: 12px; color: var(--text-dim); margin-bottom: 6px; }
.dialog input {
  width: 100%; padding: 8px 10px; border: 1px solid var(--border);
  border-radius: 6px; font-size: 13px; outline: none;
}
.dialog input:focus { border-color: var(--accent); }
.dialog-btns {
  display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;
}
.dialog-btns button { padding: 6px 14px; border: 1px solid var(--border); }

.toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  background: #1f2328; color: #fff; padding: 10px 20px;
  border-radius: 8px; font-size: 13px; z-index: 10001;
  box-shadow: 0 4px 16px rgba(0,0,0,0.2);
}

.commit-dialog { width: 560px; max-height: 60vh; display: flex; flex-direction: column; }
.file-list { overflow-y: auto; margin: 12px 0; border: 1px solid var(--border); border-radius: 6px; }
.file-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.file-item:last-child { border-bottom: none; }
.file-status {
  font-family: monospace; font-size: 10px; font-weight: 700;
  padding: 1px 5px; border-radius: 3px; flex-shrink: 0;
}
.file-status.M { background: #fef3c7; color: #92400e; }
.file-status.A, .file-status.`??` { background: #d1fae5; color: #065f46; }
.file-status.D { background: #fee2e2; color: #991b1b; }
.file-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.restore-btn { font-size: 11px; padding: 2px 8px; border: 1px solid var(--border); border-radius: 4px; flex-shrink: 0; }
.restore-btn:hover { background: var(--bg-hover); }
</style>
