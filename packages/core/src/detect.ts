/** The info string of a fenced code block that holds a spec. */
export const FENCE_KEYWORD = "wiredown";

/** A closing fence must use the same character and at least the opening length. */
export function closingFence(fence: string): RegExp {
  return new RegExp(`^[ \t]*${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \t]*$`);
}
