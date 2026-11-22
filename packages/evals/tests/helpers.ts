export const screen = (id: string, body: string[], heading = id) =>
  [`## ${heading}`, "", "```wiredown", ...body, "```", "", `^${id}`, ""].join("\n");
