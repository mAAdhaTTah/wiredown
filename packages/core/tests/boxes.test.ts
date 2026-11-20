import { expect, it } from "vitest";
import { layout, parse, resolve } from "../src/index";
import { fakeMeasure } from "./helpers/fakeMeasure";

it("records real nested boxes, including the whole field, at the drawing origin", () => {
  const tree = parse(
    "box: Panel #panel\n  button: Save #save\n  field: Name | input: Ada #name\n  text: Help",
  ).tree;
  const { boxes, ops } = layout(
    tree,
    { x: 17, y: 23 },
    {
      measure: fakeMeasure,
      style: { fontSize: 16, fontFamily: 5 },
    },
  );
  expect(Object.keys(boxes).sort()).toEqual(["name", "panel", "save"]);
  expect(ops).toContainEqual(expect.objectContaining({ kind: "rect", ...boxes.save }));
  expect(boxes.panel.x).toBe(17);
  expect(boxes.panel.y).toBe(23);
  for (const id of ["save", "name"]) {
    expect(boxes[id].x).toBeGreaterThanOrEqual(boxes.panel.x);
    expect(boxes[id].y + boxes[id].h).toBeLessThanOrEqual(boxes.panel.y + boxes.panel.h);
  }
  expect(boxes.name.w).toBeGreaterThan(80);
});

it("records nodes added by a variant", () => {
  const { tree, errors } = resolve("extends: base\nafter: save\n  button: Cancel #cancel", {
    lookup: () => "button: Save #save",
  });
  expect(errors).toEqual([]);
  expect(
    layout(
      tree,
      { x: 0, y: 0 },
      {
        measure: fakeMeasure,
        style: { fontSize: 16, fontFamily: 5 },
      },
    ).boxes.cancel,
  ).toBeDefined();
});
