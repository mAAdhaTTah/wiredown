import { readFileSync } from "node:fs";
import LZString from "lz-string";
import { describe, expect, it } from "vitest";
import { formatEmbed, parseEmbed } from "../src/flow.js";
import {
  newFlow,
  parseFlow,
  serializeFlow,
  type ExcalidrawElementJson,
  type Flow,
} from "../src/index";
import { pluginFailures, pluginFiles } from "./plugin-checks";

const FIXTURE = readFileSync(
  new URL("./fixtures/review-and-apply.excalidraw.md", import.meta.url),
  "utf8",
);
const F1_FILE = "6c07d35c2959f1651bd0238e2689bde52f78c9a1";

// The fixture with its drawing compressed the way the plugin saves it:
// base64 in 256-character lines separated by blank lines.
function compressed(text: string): string {
  const m = /```json\n([\s\S]*)\n```/.exec(text)!;
  const b64 = LZString.compressToBase64(m[1]);
  const lines = b64.match(/.{1,256}/g)!;
  return text.replace(m[0], "```compressed-json\n" + lines.join("\n\n") + "\n```");
}

// A person's edits: frontmatter keys and sections we don't own.
function personalised(text: string): string {
  return text
    .replace(
      "tags: [excalidraw]\n",
      "tags: [excalidraw]\ncssclasses: wide\nexcalidraw-autoexport: svg\n",
    )
    .replace(
      "## Embedded Files\n",
      "## Element Links\nzzzzzzzz: [[screens#^review-view]]\n\n## Notes\nKeep F2 wide.\n\n## Embedded Files\n",
    );
}

// The file with the parts serializeFlow owns cut out.
function unowned(text: string): string {
  return text
    .replace(/## Text Elements\n[\s\S]*?(?=^## |^%%$)/m, "")
    .replace(/## Embedded Files\n[\s\S]*?(?=^## |^%%$)/m, "")
    .replace(/(```(?:compressed-)?json\n)[\s\S]*\n```/, "$1");
}

function sceneOfText(text: string): { elements: ExcalidrawElementJson[]; rest: object } {
  const m = /```(json|compressed-json)\n([\s\S]*)\n```/.exec(text)!;
  const json = m[1] === "json" ? m[2] : LZString.decompressFromBase64(m[2].replace(/\n/g, ""));
  const { elements, ...rest } = JSON.parse(json);
  return { elements, rest };
}

const textEntries = (text: string) => /## Text Elements\n([\s\S]*?)(?=^## |^%%$)/m.exec(text)![1];

function textEl(id: string, text: string): ExcalidrawElementJson {
  return {
    id,
    type: "text",
    x: 0,
    y: 0,
    text,
    originalText: text,
    rawText: text,
    isDeleted: false,
  };
}

function image(id: string, fileId: string): ExcalidrawElementJson {
  return { id, type: "image", x: 0, y: 0, width: 100, height: 50, fileId, isDeleted: false };
}

// Serialises a mutated flow and checks what every mutation must keep.
function write(flow: Flow, before: string): string {
  const out = serializeFlow(flow);
  expect(pluginFailures(out)).toEqual([]);
  expect(unowned(out)).toBe(unowned(before).replace("compressed-json", "json"));
  const { elements, rest } = sceneOfText(out);
  expect(elements).toEqual(flow.elements);
  expect(rest).toEqual(sceneOfText(before).rest);
  expect(serializeFlow(parseFlow(out))).toBe(out);
  return out;
}

const variants = {
  json: FIXTURE,
  "compressed-json": compressed(FIXTURE),
  "person-edited": personalised(FIXTURE),
};

describe("parseFlow", () => {
  it("reads the scene and the embeds", () => {
    const flow = parseFlow(FIXTURE);
    expect(flow.elements).toHaveLength(19);
    expect(flow.elements[0]).toMatchObject({
      id: "vcQAYCKO",
      type: "text",
      rawText: "F1 · Simplified tree page",
    });
    expect(flow.appState.viewBackgroundColor).toBe("#ffffff");
    expect(flow.files).toEqual({});
    expect([...flow.embeds]).toEqual([
      [F1_FILE, { path: "screens", blockId: "simplified-tree", width: 896, height: 673 }],
      [
        "2d87b3a504f630e7baed934e0cdaa0f80773ab77",
        { path: "screens", blockId: "review-view", width: 848, height: 457 },
      ],
      [
        "59850ec31723d9c642b9725119e76354cdccfed3",
        { path: "screens", blockId: "review-applied", width: 910, height: 403 },
      ],
    ]);
  });

  it("reads a compressed drawing", () => {
    expect(parseFlow(compressed(FIXTURE)).elements).toEqual(parseFlow(FIXTURE).elements);
  });

  it("rejects a file that is not an Excalidraw drawing", () => {
    expect(() => parseFlow("# Notes\n\nJust text.\n")).toThrow(/not an Excalidraw drawing/);
    expect(() => parseFlow(FIXTURE.replace("# Excalidraw Data", "# Data"))).toThrow(
      /not an Excalidraw drawing/,
    );
  });

  it("rejects drawing JSON that does not parse", () => {
    expect(() =>
      parseFlow(FIXTURE.replace('"type": "excalidraw",', '"type": excalidraw,')),
    ).toThrow(/drawing JSON does not parse/);
    expect(() => parseFlow(FIXTURE.replace(/```json\n[\s\S]*\n```/, "```json\n[]\n```"))).toThrow(
      /no elements array/,
    );
    expect(() =>
      parseFlow(FIXTURE.replace(/```json\n[\s\S]*\n```/, "```compressed-json\n!!!\n```")),
    ).toThrow(/does not decompress|does not parse/);
  });
});

describe("serializeFlow round trip", () => {
  for (const [name, text] of Object.entries(variants)) {
    it(`reproduces the ${name} file byte for byte`, () => {
      expect(serializeFlow(parseFlow(text))).toBe(name === "compressed-json" ? FIXTURE : text);
    });
  }

  it("rewrites compressed drawings as plugin-compatible JSON", () => {
    for (const changed of [false, true]) {
      const flow = parseFlow(compressed(FIXTURE));
      expect(flow.compressed).toBe(true);
      if (changed) flow.elements[0].x = 10;
      const out = serializeFlow(flow);
      expect(out).toContain("```json");
      expect(out).not.toContain("```compressed-json");
      expect(pluginFailures(out)).toEqual([]);
      expect(parseFlow(out).elements).toEqual(flow.elements);
      expect(parseFlow(out).compressed).toBe(false);
    }
  });

  it("regenerates the owned parts exactly as the plugin wrote them", () => {
    // A text change touches only that entry and the element's fields.
    const flow = parseFlow(FIXTURE);
    const no = flow.elements.find((e) => e.id === "fSDHrM4i")!;
    Object.assign(no, { text: "no: Keep", originalText: "no: Keep", rawText: "no: Keep" });
    expect(write(flow, FIXTURE)).toBe(
      FIXTURE.replace("no: Apply ^fSDHrM4i", "no: Keep ^fSDHrM4i").replaceAll(
        '"no: Apply"',
        '"no: Keep"',
      ),
    );
  });
});

describe("serializeFlow after a change", () => {
  for (const [name, text] of Object.entries(variants)) {
    describe(name, () => {
      it("adds an entry for a new text element", () => {
        const flow = parseFlow(text);
        flow.elements.push(textEl("NewText1", "A note"));
        const out = write(flow, text);
        expect(textEntries(out)).toBe(textEntries(text) + "A note ^NewText1\n\n");
      });

      it("writes multi-line text as the plugin does", () => {
        const flow = parseFlow(text);
        flow.elements.push(textEl("NewText2", "Two\nlines"));
        expect(textEntries(write(flow, text))).toContain("^fSDHrM4i\n\nTwo\nlines ^NewText2\n\n");
      });

      it("updates the entry of changed text", () => {
        const flow = parseFlow(text);
        Object.assign(flow.elements[0], {
          text: "F1 · Tree",
          originalText: "F1 · Tree",
          rawText: "F1 · Tree",
        });
        const out = write(flow, text);
        expect(textEntries(out)).toBe(
          textEntries(text).replace("F1 · Simplified tree page ^vcQAYCKO", "F1 · Tree ^vcQAYCKO"),
        );
      });

      it("drops the entry of a deleted text element", () => {
        const flow = parseFlow(text);
        flow.elements.find((e) => e.id === "DwhCCD1z")!.isDeleted = true;
        const out = write(flow, text);
        expect(textEntries(out)).toBe(
          textEntries(text).replace("Later steps on\nthose boards? ^DwhCCD1z\n\n", ""),
        );
        expect(sceneOfText(out).elements.find((e) => e.id === "DwhCCD1z")).toMatchObject({
          isDeleted: true,
        });
      });

      it("adds the Embedded Files line for a new image", () => {
        const flow = parseFlow(text);
        flow.elements.push(image("NewImage", "f00d"));
        flow.embeds.set("f00d", { path: "screens", blockId: "settings", width: 300, height: 200 });
        const out = write(flow, text);
        expect([...pluginFiles(out)].at(-1)).toEqual(["f00d", "screens#^settings|300x200"]);
        expect(out).toContain("|910x403]]\n\nf00d: [[screens#^settings|300x200]]\n\n%%\n");
      });

      it("rewrites a changed embed size", () => {
        const flow = parseFlow(text);
        flow.embeds.set(F1_FILE, { ...flow.embeds.get(F1_FILE)!, width: 900 });
        const out = write(flow, text);
        expect(pluginFiles(out).get(F1_FILE)).toBe("screens#^simplified-tree|900x673");
        expect(pluginFiles(out).size).toBe(3);
      });

      it("drops the line once no image uses the file", () => {
        const flow = parseFlow(text);
        const f1 = flow.elements.find((e) => e.fileId === F1_FILE)!;
        flow.elements.push({ ...f1, id: "copyOfF1" });
        f1.isDeleted = true;
        expect(pluginFiles(write(flow, text)).has(F1_FILE)).toBe(true);
        flow.elements.pop();
        const out = write(flow, text);
        expect(pluginFiles(out).has(F1_FILE)).toBe(false);
        expect(pluginFiles(out).size).toBe(2);
      });

      it("drops the Embedded Files section with its last image", () => {
        const flow = parseFlow(text);
        flow.elements = flow.elements.filter((e) => e.type !== "image");
        const out = serializeFlow(flow);
        expect(pluginFailures(out)).toEqual([]);
        expect(out).not.toContain("## Embedded Files");
        expect(out).toContain(
          "fSDHrM4i\n\n" + (name === "person-edited" ? "## Element Links" : "%%\n## Drawing"),
        );
      });
    });
  }

  it("keeps a URL entry that is not a [[link]]", () => {
    const text = FIXTURE.replace(
      `${F1_FILE}: [[screens#^simplified-tree|896x673]]`,
      `${F1_FILE}: https://example.com/a.png`,
    );
    const flow = parseFlow(text);
    expect(flow.embeds.has(F1_FILE)).toBe(false);
    flow.elements.push(textEl("NewText3", "x"));
    expect(serializeFlow(flow)).toContain(`${F1_FILE}: https://example.com/a.png\n\n`);
  });

  it("keeps the rest of a link entry when its size changes", () => {
    const text = FIXTURE.replace(
      `${F1_FILE}: [[screens#^simplified-tree|896x673]]`,
      `${F1_FILE}: ![[screens#^simplified-tree|896x673]] {"#000":"#fff"}`,
    );
    const flow = parseFlow(text);
    flow.embeds.get(F1_FILE)!.height = 700;
    expect(serializeFlow(flow)).toContain(
      `${F1_FILE}: ![[screens#^simplified-tree|896x700]] {"#000":"#fff"}\n\n`,
    );
  });

  it("refuses a text element id the plugin cannot find", () => {
    const flow = parseFlow(FIXTURE);
    flow.elements.push(textEl("too-long-id", "x"));
    expect(() => serializeFlow(flow)).toThrow(/must be 8 characters/);
  });
});

describe("newFlow", () => {
  it("writes the Excalidraw Markdown header and an empty drawing", () => {
    const text = serializeFlow(newFlow());
    expect(text.slice(0, text.indexOf("# Excalidraw Data"))).toBe(
      FIXTURE.slice(0, FIXTURE.indexOf("# Excalidraw Data")),
    );
    expect(text).toContain(
      '# Excalidraw Data\n\n## Text Elements\n%%\n## Drawing\n```json\n{\n\t"type": "excalidraw",',
    );
    expect(text.endsWith('\t"files": {}\n}\n```\n%%')).toBe(true);
    expect(pluginFailures(text)).toEqual([]);
    expect(serializeFlow(parseFlow(text))).toBe(text);
    expect(newFlow().elements).toEqual([]);
  });

  it("gains sections in the plugin's order", () => {
    const flow = newFlow();
    flow.elements.push(textEl("FirstTxt", "F1"), image("FirstImg", "abc123"));
    flow.embeds.set("abc123", { path: "screens", blockId: "home", width: 400, height: 300 });
    const out = serializeFlow(flow);
    expect(pluginFailures(out)).toEqual([]);
    expect(out).toContain(
      "## Text Elements\nF1 ^FirstTxt\n\n## Embedded Files\nabc123: [[screens#^home|400x300]]\n\n%%\n## Drawing\n",
    );
    expect(serializeFlow(parseFlow(out))).toBe(out);
  });
});

describe("embed links", () => {
  it("formats and parses screens#^id|WxH", () => {
    const link = { path: "screens", blockId: "review-view", width: 848, height: 457 };
    expect(formatEmbed(link)).toBe("screens#^review-view|848x457");
    expect(parseEmbed("screens#^review-view|848x457")).toEqual(link);
  });

  it("follows the plugin's grammar for other forms", () => {
    expect(parseEmbed("screens")).toEqual({ path: "screens" });
    expect(parseEmbed("screens#^id|300")).toEqual({ path: "screens", blockId: "id", width: 300 });
    expect(parseEmbed("screens#Review view|300")).toEqual({
      path: "screens",
      heading: "Review view",
      width: 300,
    });
    expect(parseEmbed("a/pic.png|x200")).toEqual({ path: "a/pic.png", height: 200 });
    for (const s of ["screens", "screens#^id|300", "screens#Review view|300", "a/pic.png|x200"]) {
      expect(formatEmbed(parseEmbed(s))).toBe(s);
    }
  });
});

describe("structure is found from the plugin's markers, not text content", () => {
  const passes = (text: string) => {
    const one = serializeFlow(parseFlow(text));
    const two = serializeFlow(parseFlow(one));
    expect(serializeFlow(parseFlow(two))).toBe(one);
    expect(two).toBe(one);
    return one;
  };
  const tricky = {
    heading: "hello\n## Heading\nworld",
    "plugin heading": "hello\n## Embedded Files hint\nworld",
    "%%": "hello\n%%\nworld",
    "marker-like line": "hello ^abcdefgh\nworld",
  };

  for (const [name, txt] of Object.entries(tricky)) {
    it(`keeps text containing ${name} as text, as a new last entry`, () => {
      const flow = parseFlow(FIXTURE);
      flow.elements.push(textEl("Tricky01", txt));
      const out = passes(serializeFlow(flow));
      // textEntries() would cut at the heading-like line, so look for the whole span.
      expect(out).toContain(
        textEntries(FIXTURE) + `${txt} ^Tricky01\n\n## Embedded Files\n${F1_FILE}: [[`,
      );
      expect(parseFlow(out).elements).toEqual(flow.elements);
      expect([...parseFlow(out).embeds.keys()]).toHaveLength(3);
      expect(unowned(out.replace(`${txt} ^Tricky01\n\n`, ""))).toBe(unowned(FIXTURE));
    });

    it(`keeps text containing ${name} as text, in the middle`, () => {
      const flow = parseFlow(FIXTURE);
      Object.assign(
        flow.elements.find((e) => e.id === "Rts422gy")!,
        {
          text: txt,
          originalText: txt,
          rawText: txt,
        },
      );
      const out = passes(serializeFlow(flow));
      expect(out.split(`${txt} ^Rts422gy\n\n`)).toHaveLength(2);
      expect(parseFlow(out).elements).toEqual(flow.elements);
      // A marker-like line is read as an id the scene lacks, and ignored.
      expect(parseFlow(out).source.textOrder.filter((id) => id !== "abcdefgh")).toEqual(
        parseFlow(FIXTURE).source.textOrder,
      );
    });
  }

  it("keeps a person's section after the last text entry", () => {
    const text = FIXTURE.replace(
      "## Embedded Files\n",
      "## Notes\nKeep it.\n\n## Embedded Files\n",
    );
    expect(passes(text)).toBe(text);
    const flow = parseFlow(text);
    flow.elements.push(textEl("NewText4", "A note"));
    expect(passes(serializeFlow(flow))).toContain(
      "no: Apply ^fSDHrM4i\n\nA note ^NewText4\n\n## Notes\nKeep it.\n\n## Embedded Files\n",
    );
  });

  it("keeps a person's section after Embedded Files", () => {
    const text = FIXTURE.replace("\n%%\n## Drawing", "\n## Notes\nKeep it.\n\n%%\n## Drawing");
    expect(passes(text)).toBe(text);
    const flow = parseFlow(text);
    flow.elements.push(image("NewImage", "f00d"));
    flow.embeds.set("f00d", { path: "screens", blockId: "settings", width: 3, height: 2 });
    const out = passes(serializeFlow(flow));
    expect(out).toContain(
      "|910x403]]\n\nf00d: [[screens#^settings|3x2]]\n\n## Notes\nKeep it.\n\n%%\n",
    );
    expect(pluginFailures(out)).toEqual([]);
  });

  it("reads Embedded Files entries without blank lines between them", () => {
    const text = FIXTURE.replace(/(## Embedded Files\n[\s\S]*?)(?=%%\n)/, (s) =>
      s.replaceAll("]]\n\n", "]]\n"),
    );
    expect(text).toContain("673]]\n2d87b3a504f630e7baed934e0cdaa0f80773ab77: [[");
    expect(pluginFiles(text).size).toBe(3);
    const flow = parseFlow(text);
    expect([...flow.embeds.keys()]).toEqual([...parseFlow(FIXTURE).embeds.keys()]);
    expect(serializeFlow(flow)).toBe(text);
    flow.embeds.get(F1_FILE)!.width = 900;
    expect(passes(serializeFlow(flow))).toBe(
      text.replace("simplified-tree|896x673", "simplified-tree|900x673"),
    );
  });

  it("keeps a fenced block after the drawing", () => {
    const note = "\n\nA note after the drawing:\n\n```js\nconsole.log(1);\n```\n";
    for (const base of [FIXTURE, compressed(FIXTURE)]) {
      const text = base + note;
      expect(passes(text)).toBe(FIXTURE + note);
      const flow = parseFlow(text);
      flow.elements[0].x = 5;
      const out = passes(serializeFlow(flow));
      expect(out.endsWith("```\n%%" + note)).toBe(true);
      expect(parseFlow(out).elements).toEqual(flow.elements);
    }
  });

  it("names CRLF line endings as the cause", () => {
    expect(() => parseFlow(FIXTURE.replaceAll("\n", "\r\n"))).toThrow(/CRLF/);
  });

  describe("a drawing that gains its text section after its embeds", () => {
    it("writes Text Elements before Embedded Files and stays a fixed point", () => {
      const stripped = FIXTURE.replace(/## Text Elements\n[\s\S]*?(?=^## Embedded Files$)/m, "");
      expect(stripped).not.toContain("## Text Elements");
      const once = serializeFlow(parseFlow(stripped));
      expect(once.indexOf("## Text Elements")).toBeLessThan(once.indexOf("## Embedded Files"));
      expect(pluginFailures(once)).toEqual([]);
      const again = parseFlow(once);
      expect(again.embeds.size).toBe(3);
      expect(serializeFlow(again)).toBe(once);
      expect(serializeFlow(parseFlow(serializeFlow(again)))).toBe(once);
    });
  });
});

it("writes a drawing compressed from one-line JSON with tab indentation, so it diffs", () => {
  const m = /```json\n([\s\S]*)\n```/.exec(FIXTURE)!;
  const oneLine = JSON.stringify(JSON.parse(m[1]));
  const text = FIXTURE.replace(
    m[0],
    "```compressed-json\n" + LZString.compressToBase64(oneLine) + "\n```",
  );
  expect(serializeFlow(parseFlow(text))).toBe(FIXTURE);
});
