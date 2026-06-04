/**
 * store.js
 * JSON 文件持久化 + 内存唤醒机制
 *
 * 设计原则：
 * - pending/bugs.json  → 待修复队列（FIFO）
 * - completed/bugs.json → 已修复归档
 * - 所有文件写操作串行，防止并发覆盖
 * - dequeue 返回 bug 后即从文件删除，complete 直接追加 completed
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PENDING_FILE   = path.join(__dirname, "../data/pending/bugs.json");
export const COMPLETED_FILE = path.join(__dirname, "../data/completed/bugs.json");

// ── 文件工具 ──────────────────────────────────────────────────────────────────

function ensureFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "[]", "utf8");
}

function readJSON(filePath) {
  ensureFile(filePath);
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { return []; }
}

function writeJSON(filePath, data) {
  ensureFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// ── 串行调度器（所有写操作按顺序执行）────────────────────────────────────────
const taskQueue = [];
let running = false;

function schedule(fn) {
  return new Promise((resolve, reject) => {
    taskQueue.push({ fn, resolve, reject });
    if (!running) drain();
  });
}

async function drain() {
  running = true;
  while (taskQueue.length > 0) {
    const { fn, resolve, reject } = taskQueue.shift();
    try { resolve(await fn()); }
    catch (e) { reject(e); }
  }
  running = false;
}

// ── 等待者：MCP dequeue 挂起时注册，enqueue 时唤醒 ───────────────────────────
const waiters = [];

// ── Store API ─────────────────────────────────────────────────────────────────
export const bugStore = {

  /**
   * 测试人员提交 bug → 追加写 pending → 唤醒挂起的 dequeue
   */
  enqueue(data) {
    return schedule(() => {
      const bugs = readJSON(PENDING_FILE);
      const bug = {
        id: crypto.randomUUID(),
        ...data,
        createdAt: new Date().toISOString(),
      };
      bugs.push(bug);
      writeJSON(PENDING_FILE, bugs);

      // 有 MCP 在等待 → 直接把 bug 传给它，不需要它再读文件
      if (waiters.length > 0) {
        const wake = waiters.shift();
        // 异步唤醒，避免在 schedule 锁内触发新的 schedule
        setImmediate(() => wake(bug));
      }

      return bug;
    });
  },

  /**
   * MCP 工具调用 → 取出 pending 头部（FIFO）
   * 队列为空时挂起，直到 enqueue 唤醒
   *
   * 关键：取出后立刻从文件删除，返回的 bug 对象由调用方持有，
   * complete 时直接用这个对象写 completed，不再查文件。
   */
  dequeue() {
    return new Promise((resolve) => {
      schedule(() => {
        const bugs = readJSON(PENDING_FILE);
        if (bugs.length > 0) {
          const [first, ...rest] = bugs;
          writeJSON(PENDING_FILE, rest);
          resolve(first);        // ← 立刻 resolve，不等 complete
        } else {
          // 队列空 → 挂起
          waiters.push(resolve);
        }
      });
    });
  },

  /**
   * Claude Code 修复完成 → 把 bug 对象追加到 completed
   * 调用方传入从 dequeue 拿到的完整 bug 对象（含 id / createdAt 等原始字段）
   */
  complete(bug, fixSummary) {
    if (!bug || !bug.id) return Promise.resolve(null);

    return schedule(() => {
      const completed = readJSON(COMPLETED_FILE);
      const record = {
        ...bug,
        fixSummary: fixSummary ?? null,
        completedAt: new Date().toISOString(),
      };
      completed.push(record);
      writeJSON(COMPLETED_FILE, completed);
      return record;
    });
  },

  getStatus() {
    return {
      pendingCount:    readJSON(PENDING_FILE).length,
      completedCount:  readJSON(COMPLETED_FILE).length,
      waitingMcpCalls: waiters.length,
    };
  },

  listPending()   { return readJSON(PENDING_FILE); },
  listCompleted() { return readJSON(COMPLETED_FILE); },
};
