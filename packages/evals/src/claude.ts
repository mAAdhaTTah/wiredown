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

const tail = (text: string) => text.trim().split("\n").slice(-5).join("\n");

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function parse(stdout: string): Record<string, unknown> | undefined {
  try {
    const json: unknown = JSON.parse(stdout);
    return isRecord(json) ? json : undefined;
  } catch {
    return undefined;
  }
}

/** An optional number field; anything else but absence is a malformed result. */
function count(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ClaudeError(`claude -p's result has a non-numeric "${key}"`);
  }
  return value;
}

/** The reply in a successful JSON result, its fields validated. */
export function readResult(json: Record<string, unknown>): ClaudeReply {
  if (typeof json.result !== "string") {
    throw new ClaudeError(
      json.result === undefined
        ? "claude -p's result has no reply text"
        : `claude -p's result has a non-string reply (${typeof json.result})`,
    );
  }
  if (!json.result.trim()) throw new ClaudeError("claude -p returned an empty reply");
  if (json.usage !== undefined && !isRecord(json.usage)) {
    throw new ClaudeError('claude -p\'s result has a malformed "usage"');
  }
  const u = json.usage ?? {};
  const cost = count(json, "total_cost_usd");
  const models = isRecord(json.modelUsage) ? Object.keys(json.modelUsage) : [];
  return {
    text: json.result,
    usage: {
      inputTokens:
        (count(u, "input_tokens") ?? 0) +
        (count(u, "cache_creation_input_tokens") ?? 0) +
        (count(u, "cache_read_input_tokens") ?? 0),
      outputTokens: count(u, "output_tokens") ?? 0,
      ...(cost !== undefined ? { costUsd: cost } : {}),
      ...(models.length ? { model: models.join(", ") } : {}),
    },
  };
}

interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run the child to its end; rejects only when it can't start. */
function spawnClaude(
  command: string,
  args: string[],
  prompt: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
) {
  return new Promise<Exit>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
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
      resolve({ code, signal, stdout, stderr, timedOut });
    });
    child.stdin.end(prompt);
  });
}

/**
 * Run one prompt through `claude -p`, the prompt on stdin. Every failure is
 * a ClaudeError, and the temp directory is removed on every path.
 */
export async function runClaude(prompt: string, options: ClaudeOptions): Promise<ClaudeReply> {
  const { model, timeoutMs, command = "claude" } = options;
  const env = { ...process.env, ...options.env };
  for (const name of PARENT_SESSION) delete env[name];
  const cwd = mkdtempSync(join(tmpdir(), "wiredown-eval-"));
  try {
    const exit = await spawnClaude(command, claudeArgs(model), prompt, cwd, env, timeoutMs);
    if (exit.timedOut) throw new ClaudeError(`claude -p timed out after ${timeoutMs} ms`);
    const json = parse(exit.stdout);
    if (exit.code !== 0 || json?.is_error === true) {
      const why =
        (typeof json?.result === "string" && json.result) ||
        tail(exit.stderr) ||
        tail(exit.stdout) ||
        `signal ${exit.signal}`;
      throw new ClaudeError(`claude -p failed (exit ${exit.code}): ${why}`);
    }
    if (!json) throw new ClaudeError(`claude -p printed no JSON result: ${tail(exit.stdout)}`);
    return readResult(json);
  } catch (error) {
    throw error instanceof ClaudeError ? error : new ClaudeError(String(error));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
