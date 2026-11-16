import { describe, expect, it } from "vitest";
import { extractSpec, fenceSpec, specAtLine } from "../src/index.js";

const plain = (text: string) => extractSpec(text, { plain: true });
const fencedOnly = (text: string) => extractSpec(text, { plain: false });

describe("fenced blocks", () => {
  it("takes the content of a wiredown block", () => {
    expect(fencedOnly("```wiredown\nbutton: A\n```")).toBe("button: A");
  });

  it("takes the first block from surrounding text", () => {
    const note = "Intro\n\n```wiredown\nrow:\n  button: A\n```\n\n```wiredown\ntext: B\n```";
    expect(fencedOnly(note)).toBe("row:\n  button: A");
  });

  it("accepts tildes, longer fences, spaces and any case in the keyword", () => {
    expect(fencedOnly("~~~ Wiredown \nbutton: A\n~~~")).toBe("button: A");
    expect(fencedOnly("````wiredown\nbutton: A\n```\n````")).toBe("button: A\n```");
  });

  it("removes indentation shared by every line", () => {
    expect(fencedOnly("  ```wiredown\n    row:\n      button: A\n  ```")).toBe("row:\n  button: A");
  });

  it("reads to the end when the block is not closed", () => {
    expect(fencedOnly("```wiredown\nbutton: A\n")).toBe("button: A");
  });

  it("returns the content even if it has errors, so they get reported", () => {
    expect(fencedOnly("```wiredown\nnonsense\n```")).toBe("nonsense");
  });

  it("ignores empty blocks and other languages", () => {
    expect(fencedOnly("```wiredown\n\n```")).toBeNull();
    expect(plain("```js\nbutton: A\n```")).toBeNull();
    expect(fencedOnly("```wiredownish\nbutton: A\n```")).toBeNull();
  });

  it("accepts Windows line endings", () => {
    expect(fencedOnly("```wiredown\r\nbutton: A\r\nbutton: B\r\n```")).toBe("button: A\nbutton: B");
  });
});

describe("plain specs", () => {
  it("takes text that parses without errors", () => {
    expect(plain("tabs: A | *B\n  button: Save")).toBe("tabs: A | *B\n  button: Save");
  });

  it("trims blank lines and shared indentation", () => {
    expect(plain("\n\n    grid\n    a, b\n\n")).toBe("grid\na, b");
  });

  it("rejects text with any error", () => {
    expect(plain("button: A\nsome prose")).toBe("button: A\nsome prose"); // continuation, no error
    expect(plain("Hello there\nbutton: A")).toBeNull();
    expect(plain("button: A\n\nsome prose")).toBeNull();
  });

  it("rejects ordinary text", () => {
    expect(plain("Note: remember the milk")).toBeNull();
    expect(plain("https://example.com")).toBeNull();
    expect(plain("")).toBeNull();
    expect(plain("   \n ")).toBeNull();
  });

  it("is off when plain is false", () => {
    expect(fencedOnly("button: A")).toBeNull();
  });
});

describe("specAtLine", () => {
  const note = [
    "# Notes", // 0
    "```wiredown", // 1
    "button: A", // 2
    "```", // 3
    "text between", // 4
    "~~~~ Wiredown", // 5
    "  row:", // 6
    "    button: B", // 7
    "~~~~", // 8
    "```js", // 9
    "x", // 10
    "```", // 11
  ].join("\n");

  it("finds the block around the line, fences included", () => {
    expect(specAtLine(note, 1)).toBe("button: A");
    expect(specAtLine(note, 2)).toBe("button: A");
    expect(specAtLine(note, 3)).toBe("button: A");
    expect(specAtLine(note, 7)).toBe("row:\n  button: B");
  });

  it("finds nothing outside a wiredown block", () => {
    expect(specAtLine(note, 0)).toBeNull();
    expect(specAtLine(note, 4)).toBeNull();
    expect(specAtLine(note, 10)).toBeNull();
  });

  it("runs an unclosed block to the end of the text", () => {
    expect(specAtLine("```wiredown\nbutton: A\nbutton: B", 2)).toBe("button: A\nbutton: B");
  });

  it("finds nothing in an empty block", () => {
    expect(specAtLine("```wiredown\n\n```", 1)).toBeNull();
  });
});

describe("fenceSpec", () => {
  it("wraps a spec so that pasting it finds the same spec", () => {
    expect(fenceSpec("row:\n  button: A\n")).toBe("```wiredown\nrow:\n  button: A\n```");
    expect(extractSpec(fenceSpec("row:\n  button: A"), { plain: false })).toBe("row:\n  button: A");
  });

  it("uses a longer fence when the spec holds backticks", () => {
    expect(fenceSpec("text: ```")).toBe("````wiredown\ntext: ```\n````");
  });
});
