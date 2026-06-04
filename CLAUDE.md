---
name: agentation-qa-skill
description: >
  QA 提测工作流。当用户说"进入提测"时使用此 skill。
  必须连接 MCP server「agentation-qa-mcp-server」并调用其工具驱动修复循环。
  complete_bug 返回后必须立即再次调用 wait_for_bug_report，直到用户说"结束提测"。
  配合 agentation-zero (https://github.com/WtecHtec/agentation-zero) 使用。
version: 1.0.0
---

# QA 提测工作流

## 触发条件

用户说 **"进入提测"** → 连接 `agentation-qa-mcp-server`，立即调用 `wait_for_bug_report`。

---

## 工作循环（不可中断）

```
LOOP:
  1. 调用 wait_for_bug_report          ← 阻塞，等待返回
  2. 取出返回值中的 bug 字段，按修复规范处理
  3. 调用 complete_bug(bug, fixSummary)
  4. 不等待用户输入，不输出等待提示
  5. 立即回到第 1 步，再次调用 wait_for_bug_report
LOOP
```

**退出条件：只有用户说"结束提测"时才退出，其他任何情况都必须继续循环。**

---

## 关键规则

- `complete_bug` 返回后，**下一个动作必须是调用 `wait_for_bug_report`**，没有例外
- 不能在两次调用之间输出"等待中…"、"已就绪"、"已修复，是否继续"等提示
- 不能因为"感觉任务完成了"就停下来，循环由用户显式结束
- 禁止使用 `Monitor` 工具，禁止轮询任何接口；等待新 bug 只能调用 `wait_for_bug_report`
- `wait_for_bug_report` 阻塞是正常行为，不要把它当作卡死或失败

---

## Bug 数据格式

`wait_for_bug_report` 返回结构：

```jsonc
{
  "bug": {
    "id": "f0dc9f2d-...",
    "sourceLocation": "src/pages/merchant/hotel/list/index.tsx:226:14",
    "description": "修改「重置」文案为「清空」",
    "element": "\"重 置\"",
    "createdAt": "2026-06-04T05:45:43.359Z"
  },
  "_instruction": "修复此 bug，完成后调用 complete_bug，然后立即再次调用 wait_for_bug_report"
}
```

`_instruction` 字段是强制指令，必须执行。

---

## 修复规范

1. 用 `sourceLocation` 的 `文件路径:行号` 直接跳转，读前后 10 行上下文
2. 用 `element` 二次确认位置
3. **只改 `description` 描述的内容**，不动其他代码
4. 改后重读该行确认正确

**fixSummary 格式**：`文件路径:行号 — 改了什么`

---

## 异常处理

| 情况 | 处理 |
|------|------|
| 文件不存在 | 全局搜索 `element` 值定位后修复 |
| 行号与 `element` 不符 | 在文件内搜索 `element` 值 |
| 无法修复 | 调用 `complete_bug`，fixSummary 注明原因，**立即继续下一轮** |

---

## MCP 工具

| 工具名 | 说明 |
|--------|------|
| `wait_for_bug_report` | 阻塞等待新 bug，返回 `{ bug, _instruction }` |
| `complete_bug(bug, fixSummary)` | 归档，返回后必须立即再调 `wait_for_bug_report` |
| `get_queue_status` | 仅结束提测时调用一次 |

---

## 结束提测

用户说 **"结束提测"** 时：
1. 完成当前 bug（如有）
2. 调用一次 `get_queue_status`
3. 输出：`本轮共修复 N 条，剩余 M 条未处理`
4. 退出循环
