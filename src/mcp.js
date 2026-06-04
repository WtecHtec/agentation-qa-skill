/**
 * mcp.js — 纯 MCP Server（stdio）
 * stdout 零输出，所有日志走 stderr
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { bugStore } from "./store.js";

const server = new McpServer({ name: "agentation-qa-mcp-server", version: "1.0.0" });

server.tool(
  "wait_for_bug_report",
  {
    description:
      "阻塞等待下一条 bug。返回后必须立即修复，修复完调用 complete_bug，然后再次调用本工具。循环不能中断。",
  },
  async () => {
    const bug = await bugStore.dequeue();
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          bug,
          _instruction: "修复此 bug，完成后调用 complete_bug，然后立即再次调用 wait_for_bug_report",
        }, null, 2),
      }],
    };
  }
);

server.tool(
  "complete_bug",
  {
    bug: z.object({}).passthrough().describe("wait_for_bug_report 返回的完整 bug 对象"),
    fixSummary: z.string().optional().describe("文件路径:行号 — 改了什么"),
  },
  async ({ bug, fixSummary }) => {
    if (!bug?.id) {
      return { content: [{ type: "text", text: "错误：缺少 id。立即调用 wait_for_bug_report 继续。" }] };
    }
    await bugStore.complete(bug, fixSummary);
    return {
      content: [{
        type: "text",
        text: `归档完成。立即调用 wait_for_bug_report 等待下一条。`,
      }],
    };
  }
);

server.tool(
  "get_queue_status",
  { description: "查询队列数量，仅结束提测时调用一次" },
  async () => {
    const s = bugStore.getStatus();
    return { content: [{ type: "text", text: JSON.stringify(s) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);