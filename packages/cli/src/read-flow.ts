import { newerDataVersion, parseFlow } from "@wiredown/excalidraw";
import { CommandError } from "./output";

export class NewerFlowError extends CommandError {}

/** Refuse newer metadata before a CLI command interprets or edits a drawing. */
export function parseEditableFlow(source: string, verb = "edit") {
  const flow = parseFlow(source);
  const version = newerDataVersion(flow);
  if (version !== undefined)
    throw new NewerFlowError(
      `this drawing was written by a newer wiredown (data version ${JSON.stringify(version)}); upgrade wiredown to ${verb} it`,
    );
  return flow;
}
