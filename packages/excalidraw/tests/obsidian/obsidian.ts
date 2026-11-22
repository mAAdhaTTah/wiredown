// Runs real Obsidian with the Excalidraw plugin, headless, and drives it over
// the Chrome DevTools protocol. Only `pnpm test:obsidian` uses this.
//
// The window keeps the headless default size (200x150). At a normal size the
// plugin locks up the window while drawing an embed that resolves to a
// Markdown file, so no screenshots.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OBSIDIAN_VERSION = "1.15.1";
const PLUGIN_VERSION = "2.29.0";
const PLUGIN_ID = "obsidian-excalidraw-plugin";

const cache = join(tmpdir(), "wiredown-obsidian");

async function download(url: string, file: string): Promise<void> {
  if (existsSync(file)) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/** Downloads Obsidian once per version; returns its executable. */
async function obsidianBinary(): Promise<string> {
  const dir = join(cache, `obsidian-${OBSIDIAN_VERSION}`);
  if (!existsSync(join(dir, "obsidian"))) {
    mkdirSync(cache, { recursive: true });
    const tarball = join(cache, `obsidian-${OBSIDIAN_VERSION}.tar.gz`);
    await download(
      `https://github.com/obsidianmd/obsidian-releases/releases/download/v${OBSIDIAN_VERSION}/obsidian-${OBSIDIAN_VERSION}.tar.gz`,
      tarball,
    );
    execFileSync("tar", ["xzf", tarball, "-C", cache]);
  }
  return join(dir, "obsidian");
}

async function installPlugin(vault: string): Promise<void> {
  const dir = join(vault, ".obsidian", "plugins", PLUGIN_ID);
  const cached = join(cache, `${PLUGIN_ID}-${PLUGIN_VERSION}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(cached, { recursive: true });
  for (const name of ["main.js", "manifest.json", "styles.css"]) {
    await download(
      `https://github.com/zsviczian/${PLUGIN_ID}/releases/download/${PLUGIN_VERSION}/${name}`,
      join(cached, name),
    );
    copyFileSync(join(cached, name), join(dir, name));
  }
  writeFileSync(join(vault, ".obsidian", "community-plugins.json"), JSON.stringify([PLUGIN_ID]));
}

export interface Obsidian {
  /** Evaluates `expression` in Obsidian's window and returns its (awaited) value. */
  run<T>(expression: string): Promise<T>;
  close(): Promise<void>;
}

/** Starts Obsidian on a new vault holding `files` (path → text), plugin enabled. */
export async function startObsidian(files: Record<string, string>): Promise<Obsidian> {
  const binary = await obsidianBinary();
  const home = mkdtempSync(join(tmpdir(), "wd-obs-"));
  const vault = join(home, "vault");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(vault, path, ".."), { recursive: true });
    writeFileSync(join(vault, path), text);
  }
  await installPlugin(vault);
  mkdirSync(join(home, "config", "obsidian"), { recursive: true });
  writeFileSync(
    join(home, "config", "obsidian", "obsidian.json"),
    JSON.stringify({ vaults: { wiredown: { path: vault, ts: Date.now(), open: true } } }),
  );

  const child = spawn(
    binary,
    ["--no-sandbox", "--ozone-platform=headless", "--disable-gpu", "--remote-debugging-port=0"],
    { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, "config") } },
  );
  // Obsidian writes to its home until it has exited, and a folder that gains
  // a file while it is being removed fails with ENOTEMPTY.
  const close = async () => {
    const exited = once(child, "exit");
    if (child.kill()) await exited;
    rmSync(home, { recursive: true, force: true });
  };
  try {
    const ws = await connect(child);
    let id = 0;
    const run = <T>(expression: string): Promise<T> =>
      new Promise((resolve, reject) => {
        const n = ++id;
        const onMessage = (m: MessageEvent) => {
          const d = JSON.parse(String(m.data));
          if (d.id !== n) return;
          ws.removeEventListener("message", onMessage);
          const error = d.error?.message ?? d.result.exceptionDetails?.exception?.description;
          if (error) reject(new Error(error));
          else resolve(d.result.result.value);
        };
        ws.addEventListener("message", onMessage);
        ws.send(
          JSON.stringify({
            id: n,
            method: "Runtime.evaluate",
            params: { expression, awaitPromise: true, returnByValue: true },
          }),
        );
      });
    // Wait for the vault, then leave restricted mode and load the plugin, with
    // compression off as the README asks people to set it.
    const setup = `(async () => {
      while (!window.app?.workspace?.layoutReady) await new Promise((r) => setTimeout(r, 100));
      await app.plugins.setEnable(true);
      await app.plugins.enablePlugin("${PLUGIN_ID}");
      let plugin;
      while (!(plugin = app.plugins.plugins["${PLUGIN_ID}"])?.settings)
        await new Promise((r) => setTimeout(r, 100));
      plugin.settings.compress = false;
      await plugin.saveSettings();
    })()`;
    // Obsidian may load its window once more while it starts, which ends a
    // pending evaluation; the setup then runs again in the new window.
    for (;;) {
      try {
        await run(setup);
        break;
      } catch (e) {
        if (!String(e).includes("Execution context was destroyed")) throw e;
      }
    }
    return {
      run,
      close() {
        ws.close();
        return close();
      },
    };
  } catch (e) {
    await close();
    throw e;
  }
}

// Obsidian prints its DevTools address on stderr; connect to its window.
async function connect(child: ChildProcess): Promise<WebSocket> {
  const port = await new Promise<string>((resolve, reject) => {
    let log = "";
    child.stderr!.on("data", (chunk: Buffer) => {
      log += chunk;
      const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(log);
      if (m) resolve(m[1]);
    });
    child.on("exit", (code) => reject(new Error(`Obsidian exited (${code}):\n${log}`)));
  });
  for (;;) {
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
      type: string;
      url: string;
      webSocketDebuggerUrl: string;
    }[];
    const page = targets.find((t) => t.type === "page" && t.url.startsWith("app://"));
    if (page) {
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve);
        ws.addEventListener("error", reject);
      });
      return ws;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}
