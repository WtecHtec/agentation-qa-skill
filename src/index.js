/**
 * index.js
 * QA Workflow MCP Server
 *
 * 启动时自动释放 4299 端口，支持 CORS，
 * 同时暴露 MCP（stdio）和 HTTP API（:4299）。
 */

import { execSync } from "child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import express from "express";
import cors from "cors";
import { bugStore } from "./store.js";

const PORT = 4299;

// ── 1. 启动前释放端口 ─────────────────────────────────────────────────────────
function freePort(port) {
  try {
    const pids = execSync(`lsof -t -i :${port} 2>/dev/null || true`)
      .toString()
      .trim();
    if (pids) {
      pids.split("\n").forEach((pid) => {
        pid = pid.trim();
        if (pid) {
          try {
            execSync(`kill -9 ${pid}`);
            process.stderr.write(`[agentation-qa-skill] killed pid ${pid} on :${port}\n`);
          } catch {}
        }
      });
      // 等待端口释放
      execSync("sleep 0.3");
    }
  } catch {}
}

freePort(PORT);

// ── 2. Express HTTP API ───────────────────────────────────────────────────────
const app = express();

app.use(cors());           // 允许所有来源（可按需收紧）
app.use(express.json());

/**
 * POST /api/bug-report
 * 测试人员提交 bug，body 为任意 JSON 对象
 * 自动生成 id 和 createdAt
 */
app.post("/api/bug-report", async (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return res.status(400).json({ error: "body 必须是 JSON 对象" });
    }
    const bug = await bugStore.enqueue(data);
    const status = bugStore.getStatus();
    res.json({
      success: true,
      bugId: bug.id,
      queuePosition: status.pendingCount,
      message: `bug 已接收，当前队列共 ${status.pendingCount} 条待处理`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/status — 队列状态 */
app.get("/api/status", (_req, res) => {
  res.json(bugStore.getStatus());
});

/** GET /api/pending — 所有待处理 bug */
app.get("/api/pending", (_req, res) => {
  res.json(bugStore.listPending());
});

/** GET /api/completed — 所有已修复 bug */
app.get("/api/completed", (_req, res) => {
  res.json(bugStore.listCompleted());
});

app.listen(PORT, () => {
  process.stderr.write(`[agentation-qa-skill] HTTP API ready → http://localhost:${PORT}\n`);
});

// ── 3. MCP Server（stdio，供 Claude Code 连接）────────────────────────────────
const server = new McpServer({ name: "agentation-qa-mcp-server", version: "1.0.0" });

/**
 * 工具：wait_for_bug_report
 * 挂起等待测试人员通过 /api/bug-report 提交数据
 * 返回完整的 bug JSON（含自动生成的 id / createdAt）
 */
server.tool(
  "wait_for_bug_report",
  {
    description: [
      "阻塞等待测试人员提交 bug，收到后自动唤醒并返回 bug JSON。",
      "返回字段说明：",
      "  - id: bug 唯一标识，complete_bug 时必须传入完整对象",
      "  - sourceLocation: '文件路径:行号:列号'，直接定位到要修改的代码位置",
      "  - description: 修复目标描述，以此为准",
      "  - element: 页面元素当前内容，辅助二次确认位置",
      "  - createdAt: 提交时间",
      "收到后：先读 sourceLocation 对应文件和行号，再按 description 修复，最后调用 complete_bug。",
    ].join("\n"),
  },
  async () => {
    const bug = await bugStore.dequeue();
    return {
      content: [{ type: "text", text: JSON.stringify(bug, null, 2) }],
    };
  }
);

/**
 * 工具：complete_bug
 * 修复完成后调用，把 bug 从 pending 移入 completed
 * 传入完整的 bug 对象（从 wait_for_bug_report 返回的 JSON）
 */
server.tool(
  "complete_bug",
  {
    bug: z.object({}).passthrough().describe(
      "从 wait_for_bug_report 返回的完整 bug 对象（必须包含 id、sourceLocation、description 等原始字段）"
    ),
    fixSummary: z
      .string()
      .optional()
      .describe(
        "修复摘要，格式：'文件路径:行号 — 一句话描述改了什么'，例如：'src/pages/hotel/list/index.tsx:226 — 将「重置」改为「清空」'"
      ),
  },
  async ({ bug, fixSummary }) => {
    if (!bug?.id) {
      return {
        content: [{ type: "text", text: "错误：bug 对象缺少 id 字段" }],
      };
    }
    const record = await bugStore.complete(bug, fixSummary);
    return {
      content: [
        {
          type: "text",
          text: `✅ bug #${bug.id.slice(0, 8)} 已归档\ncompletedAt: ${record.completedAt}`,
        },
      ],
    };
  }
);

/**
 * 工具：get_queue_status
 * 查看当前队列状态（pending / completed 数量）
 */
server.tool(
  "get_queue_status",
  { description: "查看 pending 队列中有多少 bug 待处理，以及已完成数量" },
  async () => {
    const status = bugStore.getStatus();
    return {
      content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
    };
  }
);

// ── 启动 MCP ──────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
