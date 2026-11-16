import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  model?: string;
}

export interface ClaudeReply {
  text: string;
  usage?: Usage;
}

export interface ClaudeOptions {
  model: string;
  timeoutMs: number;
  /** The executable; found on PATH. */
  command?: string;
  /** Extra environment, e.g. a PATH for tests. */
  env?: NodeJS.ProcessEnv;
}

/** A failed call: non-zero exit, timeout, an error result or an empty reply. */
export class ClaudeError extends Error {}

/** The system prompt of every call; the task prompt carries the syntax reference. */
export const SYSTEM_PROMPT =
  "You write wireframe specs. Answer with exactly what the user asks for, in the format they ask for.";

/**
 * Print mode, one turn, no tools, no customizations: safe mode skips
 * CLAUDE.md, skills, plugins, hooks and MCP servers, and the call runs in an
 * empty temp directory so nothing from this repo reaches the model. The
 * subscription login is used as is; nothing here needs an API key.
 */
export const claudeArgs = (model: string) => [
  "-p",
  "--model",
  model,
  "--output-format",
  "json",
  "--tools",
  "",
  "--safe-mode",
  "--no-session-persistence",
  "--system-prompt",
  SYSTEM_PROMPT,
];

// Variables that tie a process to the Claude Code session that started it.
// The nested call must be a session of its own; CLAUDE_CONFIG_DIR (the
// login) stays.
const PARENT_SESSION = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_EFFORT",
  "CLAUDE_PID",
  "AI_AGENT",
];

interface ResultJson {
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
  modelUsage?: Record<string, unknown>;
}

function parse(stdout: string): ResultJson | undefined {
  try {
    return JSON.parse(stdout) as ResultJson;
  } catch {
    return undefined;
  }
}

const tail = (text: string) => text.trim().split("\n").slice(-5).join("\n");

/** Run one prompt through `claude -p`, the prompt on stdin. */
export function runClaude(prompt: string, options: ClaudeOptions): Promise<ClaudeReply> {
  const { model, timeoutMs, command = "claude" } = options;
  const env = { ...process.env, ...options.env };
  for (const name of PARENT_SESSION) delete env[name];
  const cwd = mkdtempSync(join(tmpdir(), "wiredown-eval-"));
  return new Promise<ClaudeReply>((resolve, reject) => {
    const child = spawn(command, claudeArgs(model), { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.stdin.on("error", () => {}); // a child that exits early closes stdin
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        new ClaudeError(
          error.code === "ENOENT" || error.code === "EACCES"
            ? `"${command}" was not found on PATH or is not executable (${error.code}); ` +
                "install Claude Code and log in"
            : `could not start "${command}": ${error.message}`,
        ),
      );
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const json = parse(stdout);
      if (timedOut) return reject(new ClaudeError(`claude -p timed out after ${timeoutMs} ms`));
      if (code !== 0 || json?.is_error) {
        const why = json?.result ?? (tail(stderr) || tail(stdout) || `signal ${signal}`);
        return reject(new ClaudeError(`claude -p failed (exit ${code}): ${why}`));
      }
      if (!json)
        return reject(new ClaudeError(`claude -p printed no JSON result: ${tail(stdout)}`));
      const text = json.result ?? "";
      if (!text.trim()) return reject(new ClaudeError("claude -p returned an empty reply"));
      const u = json.usage ?? {};
      resolve({
        text,
        usage: {
          inputTokens:
            (u.input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0),
          outputTokens: u.output_tokens ?? 0,
          ...(json.total_cost_usd !== undefined ? { costUsd: json.total_cost_usd } : {}),
          ...(json.modelUsage ? { model: Object.keys(json.modelUsage).join(", ") } : {}),
        },
      });
    });
    child.stdin.end(prompt);
  }).finally(() => rmSync(cwd, { recursive: true, force: true }));
}
