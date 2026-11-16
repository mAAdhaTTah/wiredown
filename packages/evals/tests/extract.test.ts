import { describe, expect, it } from "vitest";
import { extractFile } from "../src/extract.ts";

const FILE = ["## Hello", "", "```wiredown", "text: Hello", "```", "", "^hello"].join("\n");

describe("extractFile", () => {
  it("takes the file from a four-backtick block, keeping its own fences", () => {
    expect(extractFile("````markdown\n" + FILE + "\n````")).toEqual({
      ok: true,
      content: FILE + "\n",
    });
  });

  it("accepts surrounding whitespace, CRLF, no info string and a longer tilde fence", () => {
    expect(extractFile("\n\n````\r\n" + FILE + "\r\n````\n")).toMatchObject({ ok: true });
    expect(extractFile("~~~~~md\n" + FILE + "\n~~~~~")).toMatchObject({ ok: true });
  });

  it("rejects text before or after the block", () => {
    expect(extractFile("Here it is:\n````markdown\n" + FILE + "\n````")).toEqual({
      ok: false,
      reason: "the reply does not start with a fence of four backticks",
    });
    expect(extractFile("````markdown\n" + FILE + "\n````\nHope this helps!")).toEqual({
      ok: false,
      reason: "there is text after the fenced block",
    });
  });

  it("rejects a three-backtick wrapper, which the file's own fences would close", () => {
    expect(extractFile("```markdown\n" + FILE + "\n```")).toMatchObject({ ok: false });
  });

  it("rejects an unclosed, empty or missing block", () => {
    expect(extractFile("````markdown\n" + FILE)).toEqual({
      ok: false,
      reason: "the fenced block is not closed",
    });
    expect(extractFile("````\n\n````")).toEqual({ ok: false, reason: "the fenced block is empty" });
    expect(extractFile("  \n")).toEqual({ ok: false, reason: "the reply is empty" });
    expect(extractFile(FILE)).toMatchObject({ ok: false });
  });
});
