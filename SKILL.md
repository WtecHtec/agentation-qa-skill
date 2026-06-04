---
name: agentation-qa-skill
description:  QA 提测工作流。当用户说"进入提测"时使用此 skill。
  必须连接 MCP server「agentation-qa-mcp-server」(npm run mcp) 并调用其工具驱动修复循环。
  必须启动 http(npm run start) 服务。
version: 1.0.0
---

# 限制 
1. 只需要关注当前QA提测工作流，其他的任务不需要关注。
2. 项目其他校验都不需要关注。例如： pnpm lint 、 pnpm build 等。

# agentation-qa-mcp-server 服务

切换到 agentation-qa-skill 文件夹下。
执行：  cd absolute/path/agentation-qa-skill  && npm install &&    npm run mcp

# http 服务

切换到 agentation-qa-skill 文件夹下。
执行： cd  absolute/path/agentation-qa-skill && npm install &&   npm run start

# QA 提测工作流

## 触发条件

用户说 **"进入提测"** → 连接 `agentation-qa-mcp-server`，立即调用 `wait_for_bug_report`，无需额外确认。

---

## 工作循环（不可中断）

```
LOOP:
  ① 调用 wait_for_bug_report
  ② 收到 bug 数据，解析 bug 字段
  ③ 按「修复规范」处理
  ④ 调用 complete_bug(bug, fixSummary)
  ⑤ 不等待用户输入，不输出等待提示
  ⑥ 立即回到 ①，再次调用 wait_for_bug_report
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

`wait_for_bug_report` 返回结构如下，必须读取 `bug` 字段里的完整对象，并在 `complete_bug` 时原样传回：

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

## 修复规范（必须严格遵守）

### 1. 定位

- 优先使用 `sourceLocation` 精准跳转：`文件路径:行号:列号`
- 打开文件后，先读取 **行号前后各 10 行** 的上下文，理解代码逻辑
- 用 `element` 字段的值在上下文中二次确认找对了位置

### 2. 修改

- **只改 `description` 描述的内容**，不得改动同文件其他代码
- 文案类改动：直接替换字符串，不引入任何逻辑变更
- 逻辑类改动：最小化 diff，不重构、不格式化无关代码
- 改完后检查：同文件是否还有相同问题（如同一文案出现多处）

### 3. 验证

- 改动后重新读取该文件对应行，确认修改正确
- 如果项目有测试，运行与改动文件相关的测试

### 4. fixSummary 格式

```
fixSummary = "src/pages/merchant/hotel/list/index.tsx:226 — 将「重置」改为「清空」"
```

格式：`文件路径:行号 — 一句话描述改了什么`

---

## 异常处理

| 情况 | 处理方式 |
|------|----------|
| `sourceLocation` 文件不存在 | 用 `description` 和 `element` 全局搜索，找到后修复 |
| 行号对应内容与 `element` 不符 | 在该文件内搜索 `element` 的值，找到真实位置再改 |
| 无法定位 | 调用 `complete_bug`，fixSummary 注明"无法定位，原因：..."，然后立即继续下一轮 |
| 描述有歧义 | 做最合理推断，fixSummary 注明"按最合理理解处理：..."，然后立即继续下一轮 |

---

## MCP 工具

| 工具 | 调用时机 |
|------|----------|
| `wait_for_bug_report` | 每轮开始时调用，阻塞等待新 bug |
| `complete_bug` | 修复完成或无法修复时调用，必须传入完整 bug 对象 + fixSummary |
| `get_queue_status` | 仅在用户说"结束提测"时调用一次 |

### complete_bug 调用方式

```
// bug 传入 wait_for_bug_report 返回的完整对象，不要只传 id
complete_bug(
  bug = { "id": "...", "sourceLocation": "...", "description": "...", ... },
  fixSummary = "src/pages/merchant/hotel/list/index.tsx:226 — 将「重置」改为「清空」"
)
```

`complete_bug` 返回后，必须立即再次调用 `wait_for_bug_report`。

---

## 结束提测

用户说 **"结束提测"** 时：
1. 完成当前处理中的 bug（如有）
2. 调用一次 `get_queue_status` 查看剩余
3. 汇报本轮统计：处理数量 / 修复文件列表 / 未处理原因
4. 退出循环
