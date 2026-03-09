# 内存写入交互优化方案

## 1. 现状分析

### 1.1 当前写入流程

```
用户点击 "Write to Device" → 从 hex dump 提取全部字节 → POST /api/symbols/write → 串口分 chunk 写入
```

问题：

| 问题 | 说明 |
|------|------|
| 只能整体写入 | 用户修改一个 `uint8_t` 字段，也要把整个结构体（可能数百字节）写回设备 |
| 无字段级编辑入口 | 树形视图只能展开/折叠，不能双击编辑单个字段的值 |
| Watch 窗口只读 | Watch 表达式只能查看，无法修改值并写回 |
| 后端能力浪费 | `POST /api/symbols/write` 已支持 `offset` 参数，`writeSymbolField()` 前端函数已定义，但 UI 未接入 |

### 1.2 组件能力矩阵

| 层级 | 写入能力 | 状态 |
|------|---------|------|
| API `POST /api/symbols/write` | 支持 `{name, hex_data, offset}` | ✅ 就绪 |
| API `POST /api/memory/write` | 支持 `{addr, hex_data}` | ✅ 就绪 |
| 前端 `writeSymbolField()` | 支持字段级写入 | ✅ 已定义，未接入 UI |
| 前端 `writeSymbolToDevice()` | 整体写入 | ✅ 使用中 |
| 树形视图节点 | 展开/折叠 | ❌ 无编辑 |
| Watch 窗口 | 表达式名称编辑 | ❌ 无值写入 |

## 2. 现代 IDE 交互参考

### 2.1 VS Code Debug Variables

- 变量面板树形展开 struct/array
- 双击值列 → 出现 inline input，光标自动聚焦
- 回车确认写入，Esc 取消
- 写入后自动刷新该变量及其父级
- 只有可写变量显示编辑光标，const 变量值列不可点击

### 2.2 CLion / IntelliJ IDEA

- Variables 和 Watches 面板统一交互
- 双击值 → inline editor，支持表达式求值（如 `0xFF`、`255`、`'A'`）
- 右键菜单 → "Set Value..."，弹出输入框
- 数组元素可单独修改
- 修改后值高亮闪烁提示变更

### 2.3 Eclipse CDT

- Variables / Expressions 面板
- 单击值列进入编辑模式
- 支持多种输入格式：十进制、十六进制（`0x` 前缀）、二进制（`0b` 前缀）
- 修改后值变为红色，下次 step 后恢复

### 2.4 共性总结

| 特性 | 说明 |
|------|------|
| 双击触发编辑 | 双击值区域进入 inline 编辑模式 |
| 最小粒度写入 | 只写修改的字段，不写整个结构体 |
| 格式自适应 | 根据类型自动选择输入格式（整数/浮点/hex/字符串） |
| 即时反馈 | 写入后值高亮或变色，表示刚被修改 |
| Symbols 和 Watch 统一 | 两个面板共享相同的值编辑交互 |
| const 保护 | 只读变量禁止编辑 |

## 3. 方案设计

### 3.1 交互流程

```
双击树节点值 → inline input 出现 → 用户输入新值 → 回车确认
    → 前端根据类型+offset 编码为 hex → writeSymbolField(name, offset, size, hex)
    → POST /api/symbols/write {name, offset, hex_data}
    → 串口写入目标地址的指定字节 → 刷新显示
```

### 3.2 Symbols 树形视图 — 字段级 inline 编辑

#### 触发方式

- 双击叶子节点的值区域（`.sym-tree-value`）进入编辑模式
- 非叶子节点（struct/union 容器）不可编辑
- `const` 类型节点不可编辑，双击无响应

#### Inline Input

```
┌─ sym-tree-row ──────────────────────────────────────┐
│ ▶ name: type        [  inline-input  ] (hex: 0x1A)  │
└─────────────────────────────────────────────────────┘
```

- 替换值 span 为 `<input>`，宽度自适应
- 预填当前值（十进制显示整数，浮点显示小数，hex 显示 `0x` 前缀）
- 回车 → 提交，Esc → 取消，失焦 → 取消
- 提交时根据字段类型 + size 编码为 hex bytes（小端序）

#### 输入格式支持

| 类型 | 输入示例 | 编码方式 |
|------|---------|---------|
| int8/16/32 | `42`, `-1`, `0xFF` | 整数 → 小端 hex |
| uint8/16/32 | `255`, `0xFF` | 无符号整数 → 小端 hex |
| float | `3.14`, `-0.5` | IEEE 754 → 4 字节 hex |
| double | `3.14159` | IEEE 754 → 8 字节 hex |
| bool | `true`, `1`, `0` | 0 或 1 → 1 字节 |
| enum | `2`, `0x03` | 整数 → 对应 size 的 hex |
| char | `'A'`, `65` | ASCII 或整数 → 1 字节 |
| pointer | `0x3C000000` | 地址 → 4 字节小端 hex |

#### 写入后反馈

- 成功：值文本短暂高亮（绿色闪烁 1s），然后恢复正常
- 失败：值文本短暂标红，tooltip 显示错误信息
- 自动重新读取该字段所属 symbol 的完整值并刷新树

### 3.3 Watch 窗口 — 增加值编辑

#### 当前 Watch 节点结构

```
┌─ watch-node ────────────────────────────┐
│ [×] expression_name    value    type    │
│   ├─ field1            123      int     │
│   └─ field2            0.5      float   │
└─────────────────────────────────────────┘
```

#### 新增交互

- 双击根节点或叶子节点的值区域 → inline input
- 根节点（简单类型如 `int g_counter`）：直接编辑值，调用 `POST /api/symbols/write`
- 叶子节点（struct 成员）：编辑值，通过 offset 写入
- 复合节点（struct/array 容器）：不可编辑

#### Watch 写入 API 复用

Watch 表达式求值返回的结果已包含 `addr` 和 `size`，可直接用 `POST /api/memory/write`：

```javascript
// Watch 节点写入
async function watchWriteValue(addr, size, newHex) {
    await fetch('/api/memory/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addr: '0x' + addr.toString(16), hex_data: newHex }),
    });
}
```

### 3.4 共享编辑组件

Symbols 和 Watch 的 inline 编辑逻辑高度相似，抽取为共享模块：

```
static/js/utils/inline-edit.js
├── createInlineEditor(element, currentValue, type, size)  // 创建 inline input
├── encodeValue(inputStr, type, size) → hexString           // 值编码
├── decodeValue(hexString, type, size) → displayString      // 值解码（已有）
└── flashFeedback(element, success)                         // 写入反馈动画
```

### 3.5 "Write to Device" 按钮处理

保留现有的整体写入按钮，但调整定位：

- 当用户在 hex dump 中手动编辑了多处 → 用整体写入一次提交
- 当用户只想改单个字段 → 用 inline 编辑（更高效、更安全）
- 按钮 tooltip 说明："将 hex dump 中的所有修改写入设备"

## 4. 实现计划

### Phase 1：Symbols 树形视图 inline 编辑

1. 新建 `static/js/utils/inline-edit.js` — 共享编辑组件
2. 修改 `symbols.js` 的 `_renderTreeNode()` — 值区域添加 `data-offset`、`data-size`、`data-type` 属性
3. 添加双击事件委托 — 在 `.sym-tree-value` 上触发 inline 编辑
4. 接入已有的 `writeSymbolField()` 完成写入
5. 添加写入反馈动画

### Phase 2：Watch 窗口值编辑

1. 修改 `watch.js` 的 `_buildWatchTreeNode()` — 值区域添加 `data-addr`、`data-size`、`data-type`
2. 添加双击事件委托
3. 实现 `watchWriteValue()` 调用 `POST /api/memory/write`
4. 写入后自动重新 evaluate 刷新

### Phase 3：体验优化

1. const 变量视觉区分（值区域灰色，cursor 为 `not-allowed`）
2. 输入校验（范围检查、类型检查）
3. i18n 翻译
4. 前端测试覆盖

## 5. 风险与约束

| 风险 | 缓解措施 |
|------|---------|
| 写入错误地址导致设备异常 | 写入前校验 offset + size 不超过 symbol 边界；const 禁写 |
| 大端/小端混淆 | 当前设备为小端（ARM Cortex-M），编码统一使用小端序 |
| 浮点精度丢失 | 使用 `DataView` 的 `setFloat32/64` 确保 IEEE 754 精确编码 |
| Watch 表达式可能无地址 | 对 GDB 表达式求值结果无 `addr` 的节点，禁用编辑 |
