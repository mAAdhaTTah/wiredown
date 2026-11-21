import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
// The generator is plain Node ESM, usable without building core first.
// @ts-expect-error The build script deliberately has no declaration file.
import { fontPath, generate } from "../scripts/metrics.mjs";

test("committed advances reproduce byte for byte", async () => {
  // a missing font must fail here, or the drift check would silently disappear
  expect(fontPath()).toBeTruthy();
  expect(await generate()).toBe(
    await readFile(new URL("../src/metrics-excalifont.ts", import.meta.url), "utf8"),
  );
});
