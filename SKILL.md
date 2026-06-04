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

```
① 调用 wait_for_bug_report          ← 挂起等待（正常阻塞，不是卡住）
② 收到 bug JSON，解析全部字段
③ 按下方「修复规范」处理
④ 调用 complete_bug(bug, fixSummary)
⑤ 告知用户修复结果
⑥ 回到 ①，继续等待下一条
```

> 循环持续到用户说 **"结束提测"** 为止。

---

## Bug 数据格式

每条 bug 包含以下字段，**全部必须读取**：

```jsonc
{
  "id": "f0dc9f2d-...",
  "sourceLocation": "src/pages/merchant/hotel/list/index.tsx:226:14",
  //  格式：文件路径:行号:列号
  //  → 直接打开该文件，跳到对应行列，这就是要修改的位置
  "description": "修改「重置」文案为「清空」",  // 修复目标，以此为准
  "element": "\"重 置\"",                       // 页面当前元素内容（辅助定位）
  "createdAt": "2026-06-04T05:45:43.359Z"
}
```

---

## 修复规范

### 1. 定位

- 优先使用 `sourceLocation` 精准跳转：`文件路径:行号:列号`
- 打开文件后，读取**行号前后各 10 行**的上下文，理解代码逻辑
- 用 `element` 字段的值在上下文中二次确认找对了位置

### 2. 修改

- **只改 `description` 描述的内容**，不得改动同文件其他代码
- 文案类改动：直接替换字符串，不引入任何逻辑变更
- 逻辑类改动：最小化 diff，不重构、不格式化无关代码
- 改完后检查：同文件是否有相同问题（如同一文案出现多处）

### 3. 验证

- 改动后重新读取该文件对应行，确认修改正确
- 如果项目有测试，运行与改动文件相关的测试

### 4. fixSummary 格式

```
"src/pages/merchant/hotel/list/index.tsx:226 — 将「重置」改为「清空」"
格式：文件路径:行号 — 一句话描述改了什么
```

---

## 异常处理

| 情况 | 处理方式 |
|------|----------|
| `sourceLocation` 文件不存在 | 用 `description` + `element` 全局搜索，找到后修复 |
| 行号内容与 `element` 不符 | 在该文件内搜索 `element` 的值，找到真实位置再改 |
| 无法定位 | 调用 `complete_bug`，fixSummary 注明"无法定位，原因：..." |
| 描述有歧义 | 做最合理推断，fixSummary 注明"按最合理理解处理：..." |

---

## MCP 工具

| 工具 | 调用时机 |
|------|----------|
| `wait_for_bug_report` | 每次开始等待，会阻塞（正常，不是卡住） |
| `complete_bug` | 修复完成后，必须传入完整 bug 对象 + fixSummary |
| `get_queue_status` | 需了解队列时（可选） |

### complete_bug 调用方式

```
// 传入 wait_for_bug_report 返回的完整对象，不要只传 id
complete_bug(
  bug = { "id": "...", "sourceLocation": "...", "description": "...", ... },
  fixSummary = "src/pages/merchant/hotel/list/index.tsx:226 — 将「重置」改为「清空」"
)
```

---

## 结束提测

用户说 **"结束提测"** 时：
1. 完成当前处理中的 bug（如有）
2. 调用 `get_queue_status` 查看剩余
3. 汇报本轮统计：处理数量 / 修复文件列表 / 未处理原因
4. 退出循环

---

## 项目结构

```
agentation-qa-skill/
├── SKILL.md                  ← 本文件（skill 元信息 + Claude 操作手册）
├── .mcp.json                 ← Claude Code MCP 连接配置（复制到业务项目根目录，改 cwd）
├── README.md                 ← 安装与集成说明
├── package.json
├── src/
│   ├── index.js              ← MCP Server + Express HTTP API（CORS、自动释放端口）
│   └── store.js              ← JSON 文件读写 + 串行写锁 + 唤醒队列
└── data/
    ├── pending/
    │   └── bugs.json         ← 待修复 bug（FIFO 队列）
    └── completed/
        └── bugs.json         ← 已修复归档（含 fixSummary + completedAt）
```

## 数据格式

### pending/bugs.json

```jsonc
[
  {
    "id": "f0dc9f2d-1343-4f08-a066-1cf52d876420",
    "sourceLocation": "src/pages/merchant/hotel/list/index.tsx:226:14",
    "description": "修改「重置」文案为「清空」",
    "element": "\"重 置\"",
    "createdAt": "2026-06-04T05:45:43.359Z"
  }
]
```

### completed/bugs.json

```jsonc
[
  {
    "id": "f0dc9f2d-...",
    "sourceLocation": "src/pages/merchant/hotel/list/index.tsx:226:14",
    "description": "修改「重置」文案为「清空」",
    "element": "\"重 置\"",
    "createdAt": "2026-06-04T05:45:43.359Z",
    "fixSummary": "src/pages/merchant/hotel/list/index.tsx:226 — 将「重置」改为「清空」",
    "completedAt": "2026-06-04T10:15:00.000Z"
  }
]
```

## HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/bug-report` | 提交 bug（任意 JSON，自动生成 id + createdAt） |
| GET  | `/api/status`     | 队列状态 |
| GET  | `/api/pending`    | 所有待处理 bug |
| GET  | `/api/completed`  | 所有已修复 bug |

所有接口支持 CORS，可从任意来源调用。

## 集成到业务项目

1. 把 `.mcp.json` 复制到业务项目根目录，修改 `cwd` 为 agentation-qa-skill 实际路径
2. 启动 `npm start`
3. 在 Claude Code 中说「进入提测」
4. Claude Code 会自动读取此 SKILL.md 作为操作手册
