# agentation-qa-skill

**QA 提测工作流 MCP Server** — 配合 [agentation-zero](https://github.com/WtecHtec/agentation-zero) 使用，让 Claude Code 自动等待测试反馈、精准定位代码、循环修复 bug。

---

## 工作原理

```
测试人员在页面圈选元素 (agentation-zero Toolbar)
        ↓
标注数据（含文件路径 + 行号）通过 POST /api/bug-report 推送给 agentation-qa-skill
        ↓
写入 data/pending/bugs.json，唤醒 MCP 进程
        ↓
Claude Code 读取 sourceLocation 精准跳转 → 修复 → complete_bug 归档
        ↓
complete_bug 返回后立即再次 wait_for_bug_report，持续等待下一条 bug
```

`进入提测` 后，Claude Code 会进入不可中断的修复循环：等待 bug、修复、归档、再次等待。只有用户明确发送 `结束提测` 才会退出循环。

### 双进程架构

| 进程 | 入口 | 职责 |
|------|------|------|
| `src/mcp.js` | Claude Code 通过 `.mcp.json` 自动拉起 | MCP 工具暴露（stdio，stdout 完全干净） |
| `src/http.js` | `npm start` 手动启动 | HTTP API，接收测试人员提交的 bug |

两个进程共享 `data/` 目录下的 JSON 文件通信，互不干扰。

---

## 快速开始

### 1. 安装 agentation-qa-skill

```bash
git clone <this-repo> agentation-qa-skill
cd agentation-qa-skill
npm install
```

### 2. 在业务项目中安装 agentation-zero

```bash
npm install agentation-zero --save-dev
```

### 3. 配置 vite.config.ts

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import agentationLocator from 'agentation-zero/plugins/locator'

export default defineConfig({
  plugins: [
    agentationLocator(),
    react(),
  ],
})
```

### 4. 挂载 Toolbar

```tsx
import { Agentation } from 'agentation-zero'
import 'agentation-zero/dist/style.css'

function App() {
  return (
    <>
      <Agentation />
    </>
  )
}
```

### 5. 配置 Claude Code

**安装 skill**：

```bash
mkdir -p your-project/.claude/skills/agentation-qa-skill
cp /path/to/agentation-qa-skill/SKILL.md \
   your-project/.claude/skills/agentation-qa-skill/SKILL.md
```

**配置 MCP 连接**，在业务项目根目录新建 `.mcp.json`：

```json
{
  "mcpServers": {
    "agentation-qa-mcp-server": {
      "command": "node",
      "args": ["src/mcp.js"],
      "cwd": "/absolute/path/to/agentation-qa-skill"
    }
  }
}
```

> `cwd` 必须是 agentation-qa-skill 的**绝对路径**，这是 MCP 工具无法暴露最常见的原因。

---

## 使用流程

```bash
# 终端 1：启动 HTTP API（接收 bug 提交）
cd agentation-qa-skill && npm start

# 终端 2：启动业务项目
cd your-project && npm run dev

# 在 Claude Code 中发送：
进入提测
```

Claude Code 自动连接 `agentation-qa-mcp-server`，调用 `wait_for_bug_report` 阻塞等待。

测试人员通过 agentation-zero Toolbar 圈选元素提交后，Claude Code 自动唤醒、修复、调用 `complete_bug` 归档；`complete_bug` 返回后的下一个动作必须是再次调用 `wait_for_bug_report`，不能停下来等待用户确认，也不能输出等待提示。

结束时发送：`结束提测`

---

## 提测循环规则

- `进入提测` 后立即调用 `wait_for_bug_report`
- `wait_for_bug_report` 阻塞是正常行为，不代表卡死
- 收到 bug 后按 `sourceLocation` 和 `element` 定位，只修复 `description` 描述的问题
- 修复完成或无法修复时，调用 `complete_bug(bug, fixSummary)`
- `complete_bug` 返回后必须立即再次调用 `wait_for_bug_report`
- 只有用户发送 `结束提测` 才能调用 `get_queue_status` 并退出循环

---

## 排查 MCP 工具无法暴露

按以下顺序检查：

**1. `cwd` 路径是否正确**
```bash
# 确认路径存在且含 src/mcp.js
ls /absolute/path/to/agentation-qa-skill/src/mcp.js
```

**2. 依赖是否已安装**
```bash
cd /absolute/path/to/agentation-qa-skill && npm install
```

**3. `.mcp.json` 是否在业务项目根目录**
```bash
ls your-project/.mcp.json
```

**4. 手动验证 mcp.js 能否正常启动**
```bash
cd agentation-qa-skill && node src/mcp.js
# 应该无任何 stdout 输出，只挂起等待
# 有任何 stdout 输出都会破坏 stdio 通信
```

---

## HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/bug-report` | 提交 bug（任意 JSON，自动生成 id + createdAt） |
| GET  | `/api/status`     | 队列状态 |
| GET  | `/api/pending`    | 待处理列表 |
| GET  | `/api/completed`  | 已修复列表 |

手动提交示例：

```bash
curl -X POST http://localhost:4299/api/bug-report \
  -H "Content-Type: application/json" \
  -d '{
    "sourceLocation": "src/pages/merchant/hotel/list/index.tsx:226:14",
    "description": "修改「重置」文案为「清空」",
    "element": "\"重 置\""
  }'
```

---

## 项目结构

```
agentation-qa-skill/          ← 独立运行，不放入业务项目
├── SKILL.md                  ← 复制到 your-project/.claude/skills/agentation-qa-skill/
├── .mcp.json                 ← 模板，复制到 your-project/ 并修改 cwd
├── package.json
├── src/
│   ├── mcp.js                ← MCP Server（纯 stdio，stdout 零输出）
│   ├── http.js               ← HTTP API Server（npm start 启动）
│   └── store.js              ← JSON 文件读写 + 串行写锁 + 唤醒队列
└── data/
    ├── pending/bugs.json     ← 待修复队列（FIFO）
    └── completed/bugs.json   ← 已修复归档

your-project/                 ← 业务项目
├── .claude/
│   └── skills/
│       └── agentation-qa-skill/
│           └── SKILL.md     ← 从 agentation-qa-skill/SKILL.md 复制
├── .mcp.json                 ← cwd 指向 agentation-qa-skill 绝对路径
└── ...
```

---

## 常见问题

**Q：MCP 工具没有暴露给 Claude Code？**
99% 是 `.mcp.json` 的 `cwd` 路径写错了，必须是绝对路径。参考上方「排查」章节。

**Q：处理完 bug 后 Claude Code 自动退出了？**
确认 `.claude/skills/agentation-qa-skill/SKILL.md` 已正确放置，并且内容包含强制循环规则：`complete_bug` 返回后必须立即再次调用 `wait_for_bug_report`。

**Q：为什么 Claude Code 看起来一直挂起？**
这是 `wait_for_bug_report` 在阻塞等待新 bug，属于正常状态。不要改用轮询，也不要用其他工具替代它。

**Q：多个测试人员同时提交会冲突吗？**
不会。所有写操作通过串行调度器排队，按提交顺序进入 FIFO 队列，Claude Code 逐条处理。

**Q：HTTP 服务重启后 pending 里的 bug 会丢失吗？**
不会。数据持久化在 `data/pending/bugs.json`，重启后自动恢复。
