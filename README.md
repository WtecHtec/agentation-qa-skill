# agentation-qa-skill

**QA 提测工作流 MCP Server** — 配合 [agentation-zero](https://github.com/WtecHtec/agentation-zero) 使用，让 Claude Code 自动等待测试反馈、精准定位代码、循环修复 bug。

---

## 工作原理

```
测试人员在页面圈选元素 (agentation-zero Toolbar)
        ↓
标注数据（含文件路径 + 行号）通过 POST /api/bug-report 推送给 agentation-qa-skill
        ↓
agentation-qa-skill 写入 data/pending/bugs.json，唤醒 Claude Code
        ↓
Claude Code 读取 sourceLocation 精准跳转文件行号 → 修复 → 标记完成
        ↓
bug 归档至 data/completed/bugs.json，继续等待下一条
```

`agentation-zero` 负责**标注采集**（DOM 注入位置信息 + Toolbar UI），`agentation-qa-skill` 负责**消费驱动**（MCP 等待唤醒 + Claude Code 修复循环）。

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

在 agentation-zero 的 `agentationHttp` 中，将标注数据推送到 agentation-qa-skill 的接口：

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import agentationLocator from 'agentation-zero/plugins/locator'

export default defineConfig({
  plugins: [
    react(),
    agentationLocator(),
  ],
})
```

### 4. 在页面中挂载 Toolbar

```tsx
import { Agentation } from 'agentation-zero'
import 'agentation-zero/dist/style.css'

function App() {
  return (
    <>
      {/* 你的页面内容 */}
      <Agentation />
    </>
  )
}
```

### 5. 配置 Claude Code

**安装 skill**（Claude Code 通过 `.claude/skills/` 目录自动加载行为规范）：

```bash
# 在业务项目根目录执行
mkdir -p .claude/skills/agentation-qa-skill
cp /path/to/agentation-qa-skill/SKILL.md .claude/skills/agentation-qa-skill/SKILL.md
```

安装后业务项目目录结构：

```
your-project/
├── .claude/
│   └── skills/
│       └── agentation-qa-skill/
│           └── SKILL.md    ← Claude Code 自动读取，获得完整操作规范
├── .mcp.json               ← MCP 连接配置（见下方）
└── ...
```

**配置 MCP 连接**，在业务项目根目录新建 `.mcp.json`：

```json
{
  "mcpServers": {
    "qa-workflow": {
      "command": "node",
      "args": ["src/index.js"],
      "cwd": "/absolute/path/to/agentation-qa-skill"
    }
  }
}
```

---

## 使用流程

#### 开发侧（你）

```bash
# 终端 1：启动 agentation-qa-skill（自动释放 4299 端口）
cd agentation-qa-skill && npm start

# 终端 2：启动业务项目
cd your-project && npm run dev

# 在 Claude Code 中发送：
进入提测
```

Claude Code 进入等待状态，不需要做任何其他操作。

#### 测试侧（测试人员）

1. 打开业务项目页面（本地或 Ngrok 公网地址均可）
2. 点击右下角 **Agentation Toolbar → 添加标注**
3. 圈选有问题的元素，填写描述后提交
4. 数据自动推送到 agentation-qa-skill，Claude Code 立刻开始修复

#### 结束提测

```
结束提测
```

Claude Code 汇报本轮修复统计后退出循环。

---

## Bug 数据格式

测试人员提交后，`data/pending/bugs.json` 中每条记录结构如下：

```jsonc
{
  "id": "f0dc9f2d-1343-4f08-a066-1cf52d876420",   // 自动生成
  "sourceLocation": "src/pages/merchant/hotel/list/index.tsx:226:14",
  //                  ↑ agentation-zero 从 data-agentation-location 读取
  //                    格式：文件路径:行号:列号，Claude Code 直接跳转
  "description": "修改「重置」文案为「清空」",       // 测试人员填写
  "element": "\"重 置\"",                           // 圈选的元素文案
  "createdAt": "2026-06-04T05:45:43.359Z"          // 自动生成
}
```

修复完成后归档至 `data/completed/bugs.json`，追加两个字段：

```jsonc
{
  // ...原始字段保留...
  "fixSummary": "src/pages/merchant/hotel/list/index.tsx:226 — 将「重置」改为「清空」",
  "completedAt": "2026-06-04T10:15:00.000Z"
}
```

---

## HTTP API

所有接口支持 CORS，可直接从前端或脚本调用。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/bug-report` | 提交 bug（任意 JSON，自动生成 id + createdAt） |
| GET  | `/api/status`     | 队列状态（pendingCount / completedCount） |
| GET  | `/api/pending`    | 所有待处理 bug |
| GET  | `/api/completed`  | 所有已修复 bug |

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

## MCP 工具

Claude Code 通过以下三个工具驱动修复循环：

| 工具 | 说明 |
|------|------|
| `wait_for_bug_report` | 阻塞等待新 bug，收到后返回完整 bug JSON |
| `complete_bug` | 传入完整 bug 对象 + fixSummary，移入 completed |
| `get_queue_status` | 查看 pending / completed 数量 |

---

## 项目结构

```
agentation-qa-skill/                       ← 独立运行，不放入业务项目
├── SKILL.md                  ← skill 定义（复制到业务项目 .claude/skills/agentation-qa-skill/）
├── .mcp.json                 ← MCP 连接配置模板（复制到业务项目根目录，改 cwd）
├── package.json
├── src/
│   ├── index.js              ← MCP Server + Express HTTP API（含 CORS、自动释放端口）
│   └── store.js              ← JSON 文件读写 + 串行写锁 + 唤醒队列
└── data/
    ├── pending/
    │   └── bugs.json         ← 待修复（FIFO 队列）
    └── completed/
        └── bugs.json         ← 已修复归档

your-project/                 ← 业务项目
├── .claude/
│   └── skills/
│       └── agentation-qa-skill/
│           └── SKILL.md     ← 从 agentation-qa-skill/SKILL.md 复制过来
├── .mcp.json                 ← 从 agentation-qa-skill/.mcp.json 复制，改 cwd
└── ...
```

---

## 常见问题

**Q：端口 4299 被占用怎么办？**
启动时会自动执行 `kill -9 $(lsof -t -i :4299)` 释放端口，无需手动处理。

**Q：多个测试人员同时提交 bug 会冲突吗？**
不会。所有写文件操作通过串行调度器排队执行，Node.js 单线程保证无竞争，多条 bug 按提交顺序进入 FIFO 队列，Claude Code 逐条处理。

**Q：agentation-qa-skill 进程重启后 pending 里的 bug 会丢失吗？**
不会。数据持久化在 `data/pending/bugs.json`，重启后自动恢复队列。

**Q：agentation-zero 的 Ngrok 公网地址可以用吗？**
可以。测试人员通过 Ngrok 地址访问页面并标注，数据同样会推送到本地的 `localhost:4299`（Ngrok 只透传前端，agentation-qa-skill 的请求源是你本机的 vite server）。
