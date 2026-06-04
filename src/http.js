/**
 * http.js — 独立 HTTP API Server
 * 供测试人员提交 bug，与 MCP 进程共享同一份 JSON 文件
 */

import { execSync } from "child_process";
import express from "express";
import cors from "cors";
import { bugStore } from "./store.js";

const PORT = 4299;

// 启动前释放端口
function freePort(port) {
  try {
    const pids = execSync(`lsof -t -i :${port} 2>/dev/null || true`).toString().trim();
    if (pids) {
      pids.split("\n").forEach((pid) => {
        pid = pid.trim();
        if (pid) {
          try { execSync(`kill -9 ${pid}`); } catch {}
        }
      });
      execSync("sleep 0.3");
    }
  } catch {}
}

freePort(PORT);

const app = express();
app.use(cors());
app.use(express.json());

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
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/status",    (_req, res) => res.json(bugStore.getStatus()));
app.get("/api/pending",   (_req, res) => res.json(bugStore.listPending()));
app.get("/api/completed", (_req, res) => res.json(bugStore.listCompleted()));

app.listen(PORT, () => {
  console.log(`[agentation-qa] HTTP API ready → http://localhost:${PORT}`);
});
