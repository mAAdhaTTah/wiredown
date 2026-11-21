// The Excalidraw plugin's own parsing of an .excalidraw.md (regexes copied from
// the prototype's validate-embeds.mjs, which took them from the plugin at
// 2.29.0), cross-checked against the scene. Returns the failures.
import LZString from "lz-string";

type El = Record<string, unknown> & { id: string; type: string };

export function pluginFailures(data: string): string[] {
  const fail: string[] = [];
  // ExcalidrawData.ts: the Drawing section
  const dm = /\n##? Drawing\n```(json|compressed-json)\n([\s\S]*?)\n```\n%%$/.exec(data);
  if (!dm) return ["no '## Drawing' block ending in %%"];
  const json =
    dm[1] === "json" ? dm[2] : LZString.decompressFromBase64(dm[2].replace(/[\r\n]/g, ""));
  const scene = JSON.parse(json) as { elements: El[] };
  const live = scene.elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));

  // ExcalidrawData.ts:1003 text elements
  const texts = new Set([...data.matchAll(/\s\^(.{8})[\n]+/g)].map((m) => m[1]));
  for (const t of live.filter((e) => e.type === "text")) {
    if (!texts.has(t.id)) fail.push(`text ${t.id} missing from ## Text Elements`);
  }
  for (const id of texts) if (!byId.has(id)) fail.push(`text-element regex matched ${id}`);

  // ExcalidrawData.ts:984-996 element links
  const eli = data.indexOf("## Element Links\n");
  const links = new Map(
    eli < 0
      ? []
      : [...data.substring(eli + 17).matchAll(/^(.{8}):\s*(.*)$/gm)].map((m) => [m[1], m[2]]),
  );
  for (const e of live.filter((e) => e.type === "embeddable")) {
    if (links.get(e.id) !== e.link) fail.push(`embeddable ${e.id}: Element Links disagrees`);
  }

  // ExcalidrawData.ts:1070-1091 embedded files, linkUtils.ts:27 getLinkParts
  const files = pluginFiles(data);
  for (const e of live.filter((e) => e.type === "image")) {
    const link = files.get(String(e.fileId));
    if (!link) fail.push(`image ${e.id}: fileId ${e.fileId} not in ## Embedded Files`);
    else if (!/(^[^#|]*)#?(\^)?([^|]*)?\|?(\d*)x?(\d*)/.exec(link)?.[1]) {
      fail.push(`image ${e.id}: link [[${link}]] has no path`);
    }
  }
  return fail;
}

/**
 * validate-embeds.mjs's binding check: each bound arrow is listed in both
 * ends' boundElements, and each bound text in its container's.
 */
export function bindingFailures(data: string): string[] {
  const fail: string[] = [];
  const json = /\n##? Drawing\n```json\n([\s\S]*?)\n```\n%%$/.exec(data)?.[1];
  if (!json) return ["no uncompressed '## Drawing' block"];
  const live = (JSON.parse(json) as { elements: El[] }).elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const lists = (target: El | undefined, id: string) =>
    (target?.boundElements as { id: string }[] | null | undefined)?.some((b) => b.id === id);
  for (const a of live.filter((e) => e.type === "arrow")) {
    for (const end of ["startBinding", "endBinding"]) {
      const target = byId.get(String((a[end] as { elementId?: string } | null)?.elementId));
      if (!target) fail.push(`arrow ${a.id} ${end}: no element`);
      else if (!lists(target, a.id))
        fail.push(`arrow ${a.id} ${end}: ${target.type} ${target.id} does not list it`);
    }
  }
  // and bound text: its container lists it
  for (const t of live.filter((e) => e.type === "text" && e.containerId)) {
    if (!lists(byId.get(String(t.containerId)), t.id))
      fail.push(`text ${t.id}: container ${String(t.containerId)} does not list it`);
  }
  return fail;
}

/** The plugin's view of `## Embedded Files`: fileId → link text. */
export function pluginFiles(data: string): Map<string, string> {
  const efi = data.indexOf("## Embedded Files\n");
  if (efi < 0) return new Map();
  return new Map(
    [...data.substring(efi + 18).matchAll(/([\w\d]*):\s*!?\[\[([^\]]*)]]\s*(\{[^}]*})?\n/gm)].map(
      (m) => [m[1], m[2]],
    ),
  );
}
