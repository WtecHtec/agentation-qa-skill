---
name: agentation-qa-mcp-server
description: >
  QA 提测工作流 MCP Server。当需要让 Claude Code 进入"等待测试反馈 bug → 自动修复 → 循环"
  模式时使用此 skill。触发词：用户说"进入提测"。提供 HTTP API 供测试人员提交 bug，
  MCP 工具供 Claude Code 挂起等待、标记完成、查询状态。
version: 0.0.1
---

# QA MCP Skill

## 项目结构

```
qa-mcp/
├── SKILL.md                  ← 本文件
├── CLAUDE.md                 ← Claude Code 行为提示词（放到业务项目根目录）
├── .mcp.json                 ← Claude Code MCP 连接配置（放到业务项目根目录）
├── package.json
├── src/
│   ├── index.js              ← MCP Server 入口 + Express HTTP API
│   └── store.js              ← JSON 文件读写 + 串行写锁 + 唤醒队列
└── data/
    ├── pending/
    │   └── bugs.json         ← 待修复 bug（FIFO 队列）
    └── completed/
        └── bugs.json         ← 已修复归档
```

## 安装与启动

```bash
cd agentation-qa-mcp-server
npm install
npm start
# HTTP API → http://localhost:4299
# MCP 通过 stdio 连接 Claude Code
```

## MCP 工具说明

| 工具 | 入参 | 说明 |
|------|------|------|
| `wait_for_bug_report` | 无 | 挂起等待，直到有新 bug 进入队列 |
| `complete_bug` | `bug`（完整对象）, `fixSummary?` | 标记修复完成，移入 completed |
| `get_queue_status` | 无 | 返回 pending / completed 数量 |

## HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/bug-report` | 提交 bug（任意 JSON） |
| GET  | `/api/status`     | 队列状态 |
| GET  | `/api/pending`    | 所有待处理 bug |
| GET  | `/api/completed`  | 所有已修复 bug |

所有接口支持 CORS，可从任意前端/脚本直接调用。

## 数据格式

### pending/bugs.json

```json
[
  {
    "id": "uuid-自动生成",
    "title": "登录页面崩溃",
    "description": "点击提交按钮无响应",
    "reporter": "张三",
    "createdAt": "2025-06-04T10:00:00.000Z"
  }
]
```

### completed/bugs.json

```json
[
  {
    "id": "uuid-自动生成",
    "title": "登录页面崩溃",
    "description": "...",
    "reporter": "张三",
    "createdAt": "2025-06-04T10:00:00.000Z",
    "fixSummary": "修复了 login.js 第42行空指针",
    "completedAt": "2025-06-04T10:15:00.000Z"
  }
]
```

## 核心机制

```
测试员 POST /api/bug-report
        ↓ enqueue()
  bugStore 串行写入 pending/bugs.json
        ↓ 如果有 MCP waiter
  setImmediate(() => wake(bug))    ← 唤醒挂起的 dequeue
        ↓
  wait_for_bug_report 返回 bug 给 Claude Code
        ↓
  Claude Code 分析 → 修复 → 调用 complete_bug(bug)
        ↓
  bug 追加写入 completed/bugs.json
        ↓
  Claude Code 再次调用 wait_for_bug_report（循环）
```

**并发安全**：所有文件写操作通过 `schedule()` 串行执行，Node.js 单线程保证无竞争。

## 集成到业务项目

1. 把 `.mcp.json` 复制到业务项目根目录，修改 `cwd` 为 qa-mcp 实际路径
2. 把 `CLAUDE.md` 复制到业务项目根目录
3. 启动 `npm start`
4. 在 Claude Code 中说「进入提测」