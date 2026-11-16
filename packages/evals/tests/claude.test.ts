import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ClaudeError, runClaude } from "../src/claude.ts";

// A stand-in `claude` on a temp PATH. It logs what it was given and answers
// according to STUB_MODE.
const bin = mkdtempSync(join(tmpdir(), "wiredown-stub-"));
const log = join(bin, "log.json");
writeFileSync(
  join(bin, "claude"),
  `#!/usr/bin/env node
const fs = require("node:fs");
let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({
    args: process.argv.slice(2),
    cwd: process.cwd(),
    files: fs.readdirSync(process.cwd()),
    input,
    claudecode: process.env.CLAUDECODE ?? null,
    config: process.env.CLAUDE_CONFIG_DIR ?? null,
  }));
  const mode = process.env.STUB_MODE;
  const result = (r, extra = {}) => console.log(JSON.stringify({ type: "result", result: r, ...extra }));
  if (mode === "ok") {
    result("reply to: " + input, {
      is_error: false,
      total_cost_usd: 0.002,
      usage: { input_tokens: 3, cache_creation_input_tokens: 100, cache_read_input_tokens: 20, output_tokens: 7 },
      modelUsage: { "claude-test-1": {} },
    });
  } else if (mode === "exit") {
    console.error("Not logged in. Run claude to log in.");
    process.exit(1);
  } else if (mode === "error") {
    result("There's an issue with the selected model.", { is_error: true });
    process.exit(1);
  } else if (mode === "empty") {
    result("  ");
  } else if (mode === "nonstring") {
    console.log(JSON.stringify({ result: 42 }));
  } else if (mode === "noresult") {
    console.log(JSON.stringify({ type: "result", is_error: false }));
  } else if (mode === "badcost") {
    result("fine", { total_cost_usd: "cheap" });
  } else if (mode === "array") {
    console.log("[1, 2]");
  } else if (mode === "text") {
    console.log("plain text, not JSON");
  } else if (mode === "hang") {
    setTimeout(() => {}, 60000);
  }
});
`,
);
chmodSync(join(bin, "claude"), 0o755);
afterAll(() => rmSync(bin, { recursive: true, force: true }));

const call = (mode: string, timeoutMs = 10_000) =>
  runClaude("hello", {
    model: "haiku",
    timeoutMs,
    env: {
      PATH: bin + delimiter + process.env.PATH,
      STUB_MODE: mode,
      CLAUDECODE: "1",
      CLAUDE_CONFIG_DIR: "/config",
    },
  });
const logged = () => JSON.parse(readFileSync(log, "utf8"));

describe("runClaude", () => {
  it("sends the prompt on stdin to a clean headless call and reads the JSON result", async () => {
    await expect(call("ok")).resolves.toEqual({
      text: "reply to: hello",
      usage: { inputTokens: 123, outputTokens: 7, costUsd: 0.002, model: "claude-test-1" },
    });
    const { args, cwd, files, input, claudecode, config } = logged();
    expect(args).toEqual([
      "-p",
      "--model",
      "haiku",
      "--output-format",
      "json",
      "--tools",
      "",
      "--safe-mode",
      "--no-session-persistence",
      "--system-prompt",
      expect.any(String),
    ]);
    expect(input).toBe("hello");
    // an empty temp directory, not this repo, and not tied to the parent session
    // process.cwd() is a real path (/private/var/... on macOS); tmpdir() may not be
    expect(cwd.startsWith(realpathSync(tmpdir()))).toBe(true);
    expect(files).toEqual([]);
    expect(claudecode).toBeNull();
    expect(config).toBe("/config");
  });

  it("fails on a non-zero exit with what claude printed", async () => {
    await expect(call("exit")).rejects.toThrow(
      new ClaudeError("claude -p failed (exit 1): Not logged in. Run claude to log in."),
    );
    await expect(call("error")).rejects.toThrow(
      "claude -p failed (exit 1): There's an issue with the selected model.",
    );
  });

  it("fails on an empty reply or output that is not JSON", async () => {
    await expect(call("empty")).rejects.toThrow("claude -p returned an empty reply");
    await expect(call("text")).rejects.toThrow(
      "claude -p printed no JSON result: plain text, not JSON",
    );
  });

  it("fails, without crashing, on a JSON result of the wrong shape", async () => {
    await expect(call("nonstring")).rejects.toThrow(
      new ClaudeError("claude -p's result has a non-string reply (number)"),
    );
    await expect(call("noresult")).rejects.toThrow(
      new ClaudeError("claude -p's result has no reply text"),
    );
    await expect(call("badcost")).rejects.toThrow(
      new ClaudeError('claude -p\'s result has a non-numeric "total_cost_usd"'),
    );
    await expect(call("array")).rejects.toThrow("claude -p printed no JSON result: [1, 2]");
  });

  it("removes its temp directory on every path", async () => {
    for (const mode of ["ok", "exit", "nonstring", "noresult", "empty"]) {
      await call(mode).catch(() => {});
      expect(existsSync(logged().cwd), mode).toBe(false);
    }
  });

  it("fails on a timeout", async () => {
    await expect(call("hang", 300)).rejects.toThrow("claude -p timed out after 300 ms");
  });

  it("fails when claude is not on PATH", async () => {
    await expect(
      runClaude("x", { model: "haiku", timeoutMs: 1000, command: "no-such-claude-binary" }),
    ).rejects.toThrow('"no-such-claude-binary" was not found on PATH or is not executable');
  });
});
