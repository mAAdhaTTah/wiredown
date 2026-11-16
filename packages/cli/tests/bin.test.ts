import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASE, fixture } from "./helpers.js";

// Spawns the built bin, so it needs `pnpm build` first.
const bin = fileURLToPath(new URL("../bin/wiredown.js", import.meta.url));

describe("wiredown bin", () => {
  it("prints the version", () => {
    expect(execFileSync(bin, ["--version"], { encoding: "utf8" })).toBe("0.0.0\n");
  });

  it("runs check --json and sets the exit code", async () => {
    const dir = await fixture({ "screens.md": BASE.replace("button:", "buton:") });
    const result = spawnSync(bin, ["check", "--json", join(dir, "screens.md")], {
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).files[0].errors).toHaveLength(1);
  });
});
