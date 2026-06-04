---
name: agentation-qa-skill
description: >
  QA 提测工作流 MCP Server。当用户说"进入提测"时使用此 skill，让 Claude Code 进入
  「等待测试反馈 bug → 精准定位代码 → 自动修复 → 循环」模式。
  配合 agentation-zero (https://github.com/WtecHtec/agentation-zero) 使用，
  agentation-zero 负责页面标注采集，agentation-qa-skill 负责接收数据并驱动 Claude Code 修复。
version: 1.0.0
---

# QA 提测工作流

## 触发条件

用户说 **"进入提测"** → 立即进入 bug 修复循环，无需额外确认。

---

## 工作循环

每一轮只做四件事，做完立刻进入下一轮，不输出多余内容：

```
① wait_for_bug_report        ← 阻塞等待，调用后什么都不做
② 读取 sourceLocation 定位 → 按 description 修复
③ complete_bug(bug, fixSummary)
④ 回到 ①
```

**每轮结束只输出一行**，格式：
```
✓ fixed: <文件路径:行号> — <改了什么>
```

示例：`✓ fixed: src/pages/hotel/list/index.tsx:226 — 「重置」改为「清空」`

---

## ⚠️ 严格禁止

| 禁止 | 原因 |
|------|------|
| 使用 `Monitor` 工具 | `wait_for_bug_report` 已是阻塞挂起，数据到来自动返回，无需监控 |
| 轮询 `/api/pending` 或 `/api/status` | 同上，不要用循环 + 延时检查 |
| 修复完后调用 `get_queue_status` | 不需要，直接进入下一轮 |
| 多行汇报修复详情 | 一行 `✓ fixed:` 足够，保持 token 最小消耗 |
| 询问用户是否继续 | 默认持续循环，直到用户说"结束提测" |

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
| 无法定位或无法修复 | `complete_bug`，fixSummary 注明原因，继续下一条 |

---

## MCP 工具

| 工具 | 时机 |
|------|------|
| `wait_for_bug_report` | 每轮开始，阻塞等待，**调用后不做任何其他操作** |
| `complete_bug(bug, fixSummary)` | 修复完成后立即调用，然后直接回到 wait |
| `get_queue_status` | 仅「结束提测」时调用一次 |

---

## 结束提测

用户说 **"结束提测"** 时：
1. 完成当前 bug（如有）
2. 调用一次 `get_queue_status`
3. 输出一行汇总：`本轮共修复 N 条，剩余 M 条未处理`
4. 退出循环