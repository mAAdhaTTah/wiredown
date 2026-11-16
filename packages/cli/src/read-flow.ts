import { DATA_VERSION, parseFlow } from "@wiredown/excalidraw";

export class NewerFlowError extends Error {}

/** Refuse newer metadata before a CLI command interprets or edits a drawing. */
export function parseEditableFlow(source: string) {
  const flow = parseFlow(source);
  for (const element of flow.elements) {
    const data = (element.customData as { wiredown?: { v?: unknown } } | undefined)?.wiredown;
    if (!element.isDeleted && typeof data?.v === "number" && data.v > DATA_VERSION) {
      throw new NewerFlowError(
        `this drawing was written by a newer wiredown (data version ${data.v}); upgrade wiredown to edit it`,
      );
    }
  }
  return flow;
}
