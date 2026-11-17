import { DATA_VERSION, parseFlow } from "@wiredown/excalidraw";

export class NewerFlowError extends Error {}

/** Refuse newer metadata before a CLI command interprets or edits a drawing. */
export function parseEditableFlow(source: string, verb = "edit") {
  const flow = parseFlow(source);
  const unsupported: unknown[] = [];
  for (const element of flow.elements) {
    const data = (element.customData as { wiredown?: { v?: unknown } } | undefined)?.wiredown;
    // Match the reader's version comparison, including coercion of legacy data.
    if (!element.isDeleted && data && !(((data.v ?? 1) as number) <= DATA_VERSION)) {
      unsupported.push(data.v);
    }
  }
  if (unsupported.length) {
    const numbers = unsupported.filter((v): v is number => typeof v === "number");
    const version = numbers.length ? Math.max(...numbers) : unsupported[0];
    throw new NewerFlowError(
      `this drawing was written by a newer wiredown (data version ${JSON.stringify(version)}); upgrade wiredown to ${verb} it`,
    );
  }
  return flow;
}
