import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

// The generator is plain Node ESM, usable without building core first.
// @ts-expect-error The build script deliberately has no declaration file.
import { fontPath, generate } from "../scripts/metrics.mjs";

test.skipIf(!fontPath())("committed advances reproduce byte for byte", async () => {
  expect(await generate()).toBe(
    await readFile(new URL("../src/metrics-excalifont.ts", import.meta.url), "utf8"),
  );
});
