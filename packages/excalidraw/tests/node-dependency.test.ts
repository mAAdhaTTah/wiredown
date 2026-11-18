import { expect, test, vi } from "vitest";
import { nodeDependency } from "../src/node-dependency";

test("names a missing optional Node dependency", async () => {
  const cause = new Error("Cannot find package");
  const load = vi.fn().mockRejectedValue(cause);
  await expect(nodeDependency("happy-dom", load)).rejects.toThrow("install happy-dom");
  expect(load).toHaveBeenCalledOnce();
});
