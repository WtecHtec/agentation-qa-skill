/**
 * mcp.js — 纯 MCP Server（stdio）
 * 只负责 MCP 工具暴露，不做任何 console.log / process.stdout.write
 * HTTP API 由独立的 http.js 进程处理
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { bugStore } from "./store.js";

const server = new McpServer({ name: "agentation-qa-mcp-server", version: "1.0.0" });

server.tool(
  "wait_for_bug_report",
  {
    description: [
      "阻塞等待测试人员提交 bug，收到后自动唤醒并返回 bug JSON。",
      "返回字段：id / sourceLocation(文件路径:行号:列号) / description(修复目标) / element(元素内容) / createdAt",
      "收到后：用 sourceLocation 定位文件行号 → 按 description 修复 → 调用 complete_bug。",
    ].join("\n"),
  },
  async () => {
    const bug = await bugStore.dequeue();
    return {
      content: [{ type: "text", text: JSON.stringify(bug, null, 2) }],
    };
  }
);

server.tool(
  "complete_bug",
  {
    bug: z.object({}).passthrough().describe(
      "wait_for_bug_report 返回的完整 bug 对象（必须含 id / sourceLocation / description 等原始字段）"
    ),
    fixSummary: z.string().optional().describe(
      "格式：'文件路径:行号 — 改了什么'，例如：'src/pages/hotel/list/index.tsx:226 — 将「重置」改为「清空」'"
    ),
  },
  async ({ bug, fixSummary }) => {
    if (!bug?.id) {
      return { content: [{ type: "text", text: "错误：bug 对象缺少 id 字段" }] };
    }
    await bugStore.complete(bug, fixSummary);
    return {
      content: [{ type: "text", text: "ok" }],  // 极简返回，减少 token
    };
  }
);

server.tool(
  "get_queue_status",
  { description: "查看 pending / completed 数量，仅结束提测时使用" },
  async () => {
    const status = bugStore.getStatus();
    return {
      content: [{ type: "text", text: JSON.stringify(status) }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
