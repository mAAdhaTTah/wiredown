// Runs a real Gitea in Docker with this package's dist installed, and fills a
// repository through Gitea's API. Only `pnpm test:gitea` uses this.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";

// Pinned so that a Renovate bump of Gitea runs these tests (renovate.json
// finds this line).
export const GITEA_IMAGE = "docker.io/gitea/gitea:28.4.0";
const DIST = new URL("../../dist/", import.meta.url);
// The image's GITEA_CUSTOM.
const CUSTOM = "/data/gitea";
export const USER = "wiredown";
export const PASSWORD = "wiredown-e2e";

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();

/** Installs the package as its README says: everything in dist/ copied into GITEA_CUSTOM. */
function install(container: string) {
  if (!existsSync(new URL("templates/custom/footer.tmpl", DIST)))
    throw new Error(`${DIST.pathname} is missing: build @wiredown/gitea first`);
  docker("cp", `${DIST.pathname}.`, `${container}:${CUSTOM}/`);
}

export interface Gitea {
  url: string;
  /** Calls Gitea's API as the admin; returns the parsed JSON. */
  api<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  stop(): void;
}

/** Starts Gitea with dist installed, and an admin `USER` with an API token. */
export async function startGitea(): Promise<Gitea> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const container = docker(
    "create",
    "-p",
    `127.0.0.1:${port}:3000`,
    "-e",
    "GITEA__security__INSTALL_LOCK=true",
    "-e",
    "GITEA__database__DB_TYPE=sqlite3",
    "-e",
    `GITEA__server__ROOT_URL=${url}/`,
    "-e",
    "GITEA__server__OFFLINE_MODE=true",
    GITEA_IMAGE,
  );
  const stop = () => docker("rm", "-f", container);
  try {
    install(container);
    docker("start", container);
    await waitFor(`${url}/api/healthz`);
    const gitea = (...args: string[]) => docker("exec", "-u", "git", container, "gitea", ...args);
    gitea(
      "admin",
      "user",
      "create",
      "--admin",
      "--username",
      USER,
      "--password",
      PASSWORD,
      "--email",
      "wiredown@example.invalid",
      "--must-change-password=false",
    );
    const token = gitea(
      "admin",
      "user",
      "generate-access-token",
      "--username",
      USER,
      "--scopes",
      "all",
      "--raw",
    );
    return {
      url,
      stop,
      async api<T>(method: string, path: string, body?: unknown) {
        const res = await fetch(`${url}/api/v1${path}`, {
          method,
          headers: { authorization: `token ${token}`, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
        return (await res.json()) as T;
      },
    };
  } catch (e) {
    console.error(docker("logs", container));
    stop();
    throw e;
  }
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(url: string) {
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Gitea did not answer ${url}`);
}

/** Adds files to main, or to a new branch made from main. */
export async function commit(
  gitea: Gitea,
  repo: string,
  files: Record<string, string>,
  newBranch?: string,
) {
  await gitea.api("POST", `/repos/${USER}/${repo}/contents`, {
    message: "fixtures",
    branch: "main",
    ...(newBranch ? { new_branch: newBranch } : {}),
    files: Object.entries(files).map(([path, text]) => ({
      operation: "create",
      path,
      content: Buffer.from(text).toString("base64"),
    })),
  });
}
