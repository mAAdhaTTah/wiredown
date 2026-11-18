import { expect, it } from "vitest";
import {
  DEFAULT_THEME,
  EXCALIFONT,
  FONT_SIZE,
  fontMeasurer,
  layout,
  layoutScreen,
  parse,
} from "../src/index";

it("uses deterministic Excalifont layout with kerning and shared defaults", () => {
  const tree = parse("window: Team\n  button: AVATAR #invite").tree;
  const { measure } = fontMeasurer(EXCALIFONT);
  const style = { fontSize: FONT_SIZE, fontFamily: 5 };
  expect(measure("TA", style).w).not.toBe(measure("T", style).w + measure("A", style).w);
  expect(layoutScreen(tree)).toEqual(layoutScreen(tree));
  expect(layoutScreen(tree)).toEqual(
    layout(tree, { x: 0, y: 0 }, { measure, style, theme: DEFAULT_THEME }),
  );
  const theme = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, primary: "red" } };
  expect(layoutScreen(tree, { theme, maxWidth: 400 })).toEqual(
    layout(tree, { x: 0, y: 0 }, { measure, style, theme, maxWidth: 400 }),
  );
});
