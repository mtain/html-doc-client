<script setup>
import { ref } from 'vue'

const props = defineProps({
  node: { type: Object, required: true },
  expanded: { type: Object, required: true },
  activePath: { type: String, default: null },
  depth: { type: Number, default: 0 }
})
const emit = defineEmits(['toggle', 'open', 'menu', 'drop'])

const dragOver = ref(false)

function onDragStart(e) {
  e.dataTransfer.setData('text/plain', JSON.stringify({ path: props.node.path, type: props.node.type }))
  e.dataTransfer.effectAllowed = 'move'
}
function onDragOver(e) {
  if (props.node.type !== 'dir') return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  dragOver.value = true
}
function onDragLeave() { dragOver.value = false }
function onDrop(e) {
  dragOver.value = false
  if (props.node.type !== 'dir') return
  e.preventDefault()
  try {
    const data = JSON.parse(e.dataTransfer.getData('text/plain'))
    if (data.path === props.node.path) return
    emit('drop', data, props.node.path)
  } catch {}
}

const isOpen = () => !!props.expanded[props.node.path]
</script>

<template>
  <div>
    <div
      class="tree-row"
      :class="[node.type, { active: node.type === 'file' && node.path === activePath, 'drag-over': dragOver }]"
      :style="{ paddingLeft: depth * 12 + 8 + 'px' }"
      draggable="true"
      @click="node.type === 'dir' ? emit('toggle', node) : emit('open', node)"
      @contextmenu.stop="emit('menu', $event, node)"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <span class="twisty">{{ node.type === 'dir' ? (isOpen() ? '▾' : '▸') : '' }}</span>

      <!-- 文件夹图标 -->
      <svg v-if="node.type === 'dir'" class="icon" viewBox="0 0 16 16" width="14" height="14">
        <path v-if="!isOpen()" d="M1.5 3.5a1 1 0 0 1 1-1h3.3a1 1 0 0 1 .8.4L7.2 4h6.3a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1v-9z"
          fill="none" stroke="currentColor" stroke-width="1"/>
        <path v-else d="M1.5 4.5a1 1 0 0 1 1-1h3.3a1 1 0 0 1 .8.4L7.2 5h6.3a1 1 0 0 1 1 1v.3l-1.2 5.2a1 1 0 0 1-1 .8H2.7a1 1 0 0 1-1-.8L1.5 5.5v-1z"
          fill="none" stroke="currentColor" stroke-width="1"/>
      </svg>

      <!-- HTML 文件图标 -->
      <svg v-else class="icon" viewBox="0 0 16 16" width="14" height="14">
        <path d="M4 1.5h5.5L13 5v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1z"
          fill="none" stroke="currentColor" stroke-width="1"/>
        <path d="M9.5 1.5V5H13" fill="none" stroke="currentColor" stroke-width="1"/>
        <text x="4" y="11.5" font-size="5" fill="currentColor" stroke="none" font-family="monospace">‹›</text>
      </svg>

      <span class="label">{{ node.name }}</span>
    </div>
    <template v-if="node.type === 'dir' && isOpen() && node.children">
      <TreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :expanded="expanded"
        :active-path="activePath"
        :depth="depth + 1"
        @toggle="emit('toggle', $event)"
        @open="emit('open', $event)"
        @menu="(e, n) => emit('menu', e, n)"
        @drop="(data, destDir) => emit('drop', data, destDir)"
      />
    </template>
  </div>
</template>

<script>
export default { name: 'TreeNode' }
</script>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  cursor: pointer;
  white-space: nowrap;
}
.tree-row:hover { background: var(--bg-hover); }
.tree-row.active { background: var(--bg-active); }
.tree-row.drag-over {
  background: #dbeafe;
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
}
.twisty { width: 10px; font-size: 9px; color: var(--text-dim); flex-shrink: 0; }
.icon { flex-shrink: 0; color: var(--text-dim); }
.tree-row:hover .icon { color: var(--text); }
.label { overflow: hidden; text-overflow: ellipsis; }
</style>
