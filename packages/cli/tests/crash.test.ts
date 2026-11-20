import { expect, it, vi } from "vitest";
import { run } from "../src/index";

vi.mock("../src/check", () => ({
  check: () => Promise.reject(new Error("boom")),
}));

it("rejects on an unexpected error instead of reporting bad usage", async () => {
  await expect(run(["check", "a.md"])).rejects.toThrow("boom");
});
