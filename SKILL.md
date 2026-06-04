---
name: agentation-qa-skill
description: >
  QA 提测工作流。当用户说"进入提测"时使用此 skill。
  必须连接 MCP server「agentation-qa-mcp-server」并调用其工具驱动修复循环。
version: 1.0.0
---

# QA 提测工作流

## 触发条件

用户说 **"进入提测"** → 连接 `agentation-qa-mcp-server`，立即进入 bug 修复循环。

---

## MCP Server

**server 名称**：`agentation-qa-mcp-server`
**启动命令**：`.mcp.json` 中已配置，Claude Code 自动拉起，入口为 `src/mcp.js`

可用工具：

| 工具名 | 说明 |
|--------|------|
| `wait_for_bug_report` | 阻塞等待新 bug，有数据时自动返回 |
| `complete_bug` | 标记修复完成，传入完整 bug 对象 + fixSummary |
| `get_queue_status` | 查询队列数量，仅结束时调用 |

---

## 工作循环

**必须用 `agentation-qa-mcp-server` 的工具执行以下循环，循环不能自行中断：**

```
loop:
  ① 调用 wait_for_bug_report          → 阻塞，等待返回
  ② 读取返回的 bug，按修复规范处理
  ③ 调用 complete_bug(bug, fixSummary) → 归档
  ④ 输出一行：✓ fixed: 文件路径:行号 — 改了什么
  ⑤ 立即回到 ①，不等待用户指令，不做任何其他操作
```

**⚠️ 第⑤步是关键：修复完成后必须立即调用 `wait_for_bug_report` 进入下一轮，不能停下来等待用户输入，不能退出循环。**

---

## ⚠️ 严格禁止

| 禁止 | 原因 |
|------|------|
| 修复完后停止循环或等待用户输入 | 必须立即进入下一轮 wait_for_bug_report |
| 使用 `Monitor` 工具 | wait_for_bug_report 本身是阻塞挂起，无需额外监控 |
| 轮询 `/api/pending` 或 `/api/status` | 不要用循环 + 延时检查 |
| 修复完后调用 `get_queue_status` | 直接进入下一轮，不查状态 |
| 多行汇报修复详情 | 一行 `✓ fixed:` 足够 |

---

## Bug 数据格式

```jsonc
{
  "id": "f0dc9f2d-...",
  "sourceLocation": "src/pages/merchant/hotel/list/index.tsx:226:14", // 文件路径:行号:列号
  "description": "修改「重置」文案为「清空」",   // 修复目标，以此为准
  "element": "\"重 置\"",                        // 当前元素内容，辅助定位
  "createdAt": "2026-06-04T05:45:43.359Z"
}
```

---

## 修复规范

1. 用 `sourceLocation` 的 `文件路径:行号` 直接跳转，读前后 10 行上下文
2. 用 `element` 二次确认位置正确
3. **只改 `description` 描述的内容**，不动其他代码
4. 改后重读该行确认正确

**fixSummary 格式**：`文件路径:行号 — 改了什么`

---

## 异常处理

| 情况 | 处理 |
|------|------|
| 文件不存在 | 全局搜索 `element` 值，找到后修复 |
| 行号与 `element` 不符 | 在文件内搜索 `element` 值定位 |
| 无法定位或无法修复 | 调用 `complete_bug`，fixSummary 注明原因，立即进入下一轮 |

---

## 结束提测

用户说 **"结束提测"** 时，才能退出循环：
1. 完成当前 bug（如有）
2. 调用一次 `get_queue_status`
3. 输出一行：`本轮共修复 N 条，剩余 M 条未处理`
4. 退出循环
