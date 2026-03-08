# Watch 面板 VS Code 体验对齐方案

## 1. 现状分析

### 1.1 当前已实现功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 表达式输入 | ✅ | 支持 C/C++ 表达式 |
| GDB 类型解析 | ✅ | whatis/sizeof/ptype |
| 设备内存读取 | ✅ | 通过串口协议 |
| 结构体展开 | ✅ | 表格形式显示字段 |
| 指针解引用 | ✅ | [→] 按钮展开 |
| 刷新单个 | ✅ | 每个条目有刷新按钮 |
| 刷新全部 | ✅ | Refresh All 按钮 |
| 删除条目 | ✅ | × 按钮 |
| 清空全部 | ✅ | Clear All 按钮 |

### 1.2 当前 UI 结构

```
┌─ WATCH ─────────────────────────────────────┐
│ [输入框] [+]                                 │
├─────────────────────────────────────────────┤
│ expr1                           [⟳] [×]     │
│   value                                      │
│ expr2                           [⟳] [×]     │
│   ┌─────────────────────────────────────┐   │
│   │ Field │ Type │ Value                │   │
│   │ ...   │ ...  │ ...                  │   │
│   └─────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│ [Refresh All] [Clear All]                   │
└─────────────────────────────────────────────┘
```

### 1.3 与 VS Code Watch 窗口的差距

| VS Code 功能 | 当前状态 | 优先级 | 说明 |
|-------------|---------|--------|------|
| **树形展开/折叠** | ❌ 缺失 | P0 | 结构体用表格，无法嵌套展开 |
| **展开箭头 ▶/▼** | ❌ 缺失 | P0 | 无法折叠/展开子节点 |
| **值变化高亮** | ❌ 缺失 | P1 | 值更新时无视觉反馈 |
| **inline 编辑值** | ❌ 缺失 | P1 | 无法直接修改变量值 |
| **表达式自动补全** | ❌ 缺失 | P2 | 输入时无符号提示 |
| **拖拽排序** | ❌ 缺失 | P3 | 无法调整顺序 |
| **右键菜单** | ❌ 缺失 | P2 | 无上下文操作 |
| **复制值/表达式** | ❌ 缺失 | P2 | 无复制功能 |
| **键盘导航** | ❌ 缺失 | P3 | 无法用键盘操作 |
| **加载状态** | ⚠️ 部分 | P1 | 无明显 loading 指示 |
| **错误状态样式** | ✅ 有 | - | 红色错误文字 |
| **悬停提示** | ⚠️ 部分 | P2 | 仅表达式有 title |
| **自动刷新** | ❌ 缺失 | P1 | 无定时刷新选项 |
| **嵌套指针展开** | ⚠️ 部分 | P1 | 只能展开一层 |

## 2. 整改方案

### 2.1 P0: 树形结构重构

**目标**: 将扁平的表格结构改为 VS Code 风格的树形列表

#### 2.1.1 数据结构

```javascript
// 当前结构 (扁平)
{
  id: 1,
  expr: "g_config",
  type_name: "struct uart_config",
  hex_data: "...",
  struct_layout: [
    { name: "baud", type_name: "uint32_t", offset: 0, size: 4 },
    { name: "parity", type_name: "uint8_t", offset: 4, size: 1 }
  ]
}

// 目标结构 (树形)
{
  id: 1,
  expr: "g_config",
  type_name: "struct uart_config",
  value: null,  // 聚合类型无直接值
  expanded: true,
  children: [
    {
      id: "1.0",
      expr: "g_config.baud",
      name: "baud",
      type_name: "uint32_t",
      value: "115200",
      hex: "00c20100",
      expanded: false,
      children: null
    },
    {
      id: "1.1",
      expr: "g_config.parity",
      name: "parity",
      type_name: "uint8_t",
      value: "0",
      hex: "00",
      expanded: false,
      children: null
    }
  ]
}
```

#### 2.1.2 UI 结构

```
┌─ WATCH ─────────────────────────────────────┐
│ [输入框________________________] [+]         │
├─────────────────────────────────────────────┤
│ ▼ g_config          struct uart_config      │
│   ├─ baud           uint32_t      115200    │
│   ├─ parity         uint8_t       0         │
│   └─▶ buf_ptr       uint8_t *     0x2000... │
│ ▶ g_counter         uint32_t      42        │
│ ▼ g_array[0:3]      int[3]                  │
│   ├─ [0]            int           1         │
│   ├─ [1]            int           2         │
│   └─ [2]            int           3         │
├─────────────────────────────────────────────┤
│ [⟳ Refresh All]                             │
└─────────────────────────────────────────────┘
```

#### 2.1.3 CSS 样式

```css
/* 树形节点 */
.watch-tree-node {
  display: flex;
  align-items: center;
  padding: 2px 0;
  padding-left: calc(var(--depth) * 16px);
  cursor: default;
  user-select: none;
}

.watch-tree-node:hover {
  background: var(--vscode-list-hoverBackground);
}

.watch-tree-node.selected {
  background: var(--vscode-list-activeSelectionBackground);
}

/* 展开箭头 */
.watch-expand-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.watch-expand-icon.collapsed::before {
  content: "▶";
  font-size: 8px;
}

.watch-expand-icon.expanded::before {
  content: "▼";
  font-size: 8px;
}

.watch-expand-icon.leaf {
  visibility: hidden;
}

/* 名称/表达式 */
.watch-node-name {
  color: var(--vscode-debugTokenExpression-name);
  margin-right: 8px;
  flex-shrink: 0;
}

/* 类型 */
.watch-node-type {
  color: var(--vscode-debugTokenExpression-type);
  margin-right: 8px;
  opacity: 0.7;
  font-size: 0.9em;
}

/* 值 */
.watch-node-value {
  color: var(--vscode-debugTokenExpression-value);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 值变化高亮 */
.watch-node-value.changed {
  background: var(--vscode-debugView-valueChangedHighlight);
  animation: value-flash 1s ease-out;
}

@keyframes value-flash {
  0% { background: var(--vscode-debugView-valueChangedHighlight); }
  100% { background: transparent; }
}
```

### 2.2 P1: 值变化高亮

**目标**: 刷新后，值发生变化的节点高亮显示

#### 实现方案

```javascript
// 保存上一次的值
const _watchPrevValues = new Map();  // id -> value

function updateWatchNodeValue(nodeId, newValue) {
  const prevValue = _watchPrevValues.get(nodeId);
  const valueEl = document.querySelector(`[data-watch-id="${nodeId}"] .watch-node-value`);
  
  if (valueEl) {
    valueEl.textContent = newValue;
    
    // 值变化时添加高亮
    if (prevValue !== undefined && prevValue !== newValue) {
      valueEl.classList.add('changed');
      setTimeout(() => valueEl.classList.remove('changed'), 1000);
    }
  }
  
  _watchPrevValues.set(nodeId, newValue);
}
```

### 2.3 P1: 自动刷新

**目标**: 支持定时自动刷新 Watch 值

#### UI 设计

```
┌─ WATCH ─────────────────────────────────────┐
│ [输入框] [+]    Auto: [▼ Off] [⟳]           │
│                       ├─ Off                │
│                       ├─ 500ms              │
│                       ├─ 1s                 │
│                       ├─ 2s                 │
│                       └─ 5s                 │
├─────────────────────────────────────────────┤
```

#### 实现方案

```javascript
let _watchAutoRefreshTimer = null;
let _watchAutoRefreshInterval = 0;  // 0 = off

function setWatchAutoRefresh(intervalMs) {
  if (_watchAutoRefreshTimer) {
    clearInterval(_watchAutoRefreshTimer);
    _watchAutoRefreshTimer = null;
  }
  
  _watchAutoRefreshInterval = intervalMs;
  
  if (intervalMs > 0) {
    _watchAutoRefreshTimer = setInterval(watchRefreshAll, intervalMs);
  }
}
```

### 2.4 P1: Inline 值编辑

**目标**: 双击值可以直接编辑，回车提交写入设备

#### UI 交互

1. 双击值 → 变为输入框
2. 输入新值 → 回车提交 / Esc 取消
3. 提交后调用 `/api/memory/write` 写入设备
4. 写入成功后刷新显示

#### 实现方案

```javascript
function onWatchValueDoubleClick(nodeId, addr, size, typeName) {
  const valueEl = document.querySelector(`[data-watch-id="${nodeId}"] .watch-node-value`);
  const currentValue = valueEl.textContent;
  
  // 创建输入框
  const input = document.createElement('input');
  input.className = 'watch-value-input';
  input.value = currentValue;
  input.style.width = '100%';
  
  input.onkeydown = async (e) => {
    if (e.key === 'Enter') {
      const newValue = input.value;
      const success = await writeWatchValue(addr, size, typeName, newValue);
      if (success) {
        valueEl.textContent = newValue;
        valueEl.classList.add('changed');
      }
      input.replaceWith(valueEl);
    } else if (e.key === 'Escape') {
      input.replaceWith(valueEl);
    }
  };
  
  valueEl.replaceWith(input);
  input.focus();
  input.select();
}
```

### 2.5 P2: 右键上下文菜单

**目标**: 右键节点显示操作菜单

#### 菜单项

```
┌─────────────────────┐
│ Copy Value          │
│ Copy Expression     │
│ Copy as Hex         │
│ ─────────────────── │
│ Set Value...        │
│ ─────────────────── │
│ Add to Watch        │  (从 Symbols 面板)
│ Remove              │
│ ─────────────────── │
│ Refresh             │
│ Collapse All        │
│ Expand All          │
└─────────────────────┘
```

### 2.6 P2: 表达式自动补全

**目标**: 输入时显示符号建议

#### 实现方案

```javascript
// 使用已加载的符号表
function setupWatchAutocomplete() {
  const input = document.getElementById('watchExprInput');
  
  input.addEventListener('input', debounce(async (e) => {
    const query = e.target.value;
    if (query.length < 2) return;
    
    // 从符号表过滤匹配项
    const suggestions = filterSymbols(query, 10);
    showAutocompleteSuggestions(suggestions);
  }, 200));
}
```

### 2.7 P3: 拖拽排序

**目标**: 支持拖拽调整 Watch 条目顺序

#### 实现方案

使用 HTML5 Drag and Drop API 或轻量库如 SortableJS。

## 3. 实现计划

| 阶段 | 任务 | 工作量 | 优先级 |
|------|------|--------|--------|
| Phase 1 | 树形结构重构 (HTML/CSS/JS) | 2天 | P0 |
| Phase 2 | 值变化高亮 | 0.5天 | P1 |
| Phase 3 | 自动刷新功能 | 0.5天 | P1 |
| Phase 4 | Inline 值编辑 | 1天 | P1 |
| Phase 5 | 右键菜单 | 1天 | P2 |
| Phase 6 | 表达式自动补全 | 1天 | P2 |
| Phase 7 | 拖拽排序 | 0.5天 | P3 |

**总计**: 约 6.5 天

## 4. 文件修改清单

| 文件 | 修改内容 |
|------|----------|
| `templates/partials/sidebar.html` | Watch 面板 HTML 结构 |
| `static/css/workbench.css` | 树形节点样式 |
| `static/js/features/watch.js` | 核心逻辑重构 |
| `static/js/locales/*.js` | 新增 i18n 文本 |
| `app/routes/watch_expr.py` | 可能需要调整 API 返回格式 |

## 5. 参考

- VS Code Debug Watch: https://code.visualstudio.com/docs/editor/debugging#_data-inspection
- VS Code 源码 (debug viewlet): https://github.com/microsoft/vscode/tree/main/src/vs/workbench/contrib/debug
- 现有设计文档: `docs/watch-expression-design.md`
