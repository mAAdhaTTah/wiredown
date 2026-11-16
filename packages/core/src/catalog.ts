import type { ComponentType, DirectiveType } from "./types.js";

// Every component a user can write, with the options it takes. The parser
// builds its keyword table and option lists from this, and the agent skill's
// syntax reference is generated from it, so the three can't drift apart.
//
// An option is listed here only if the component (or layout, for the
// common ones) reads it. `fill` is read by the parent, which gives a (fill)
// child a width; it is listed only for components that use that width.

export interface CatalogEntry {
  /** The node type the parser gives the line. */
  type: ComponentType | DirectiveType;
  /** What a user writes before the colon; the first is the usual one. */
  keywords: string[];
  description: string;
  /** Holds components indented under it. */
  container: boolean;
  /** Takes text after the colon or on continuation lines. */
  content: boolean;
  /** Words that stand alone in the brackets: `(fill, disabled)`. */
  flags: string[];
  /** Options with a number: `(w=200)`. */
  numbers: string[];
  /** A variant directive: takes no options and no id. */
  directive?: true;
}

/**
 * Flags every component takes; layout draws them the same way for all.
 * Every component also takes an id: `#name` or `(id=name)`.
 */
export const COMMON_FLAGS: readonly string[] = ["disabled", "invalid", "focus"];

/** Options the syntax no longer has, with what to write instead. */
export const RETIRED_OPTIONS: ReadonlyMap<string, string> = new Map([
  ["hi", "the highlight option is now (focus)"],
  [
    "mark",
    "number an element on the flow instead with: wiredown flow mark <flow> <frame> '#id' <label>",
  ],
]);

const BOX_FLAGS = ["fill", "plain", "dark", "collapsible", "collapsed"];
const FRAME = { container: true, content: true, flags: ["fill"], numbers: ["w", "h"] };
const FIELD_LIKE = {
  container: false,
  content: true,
  flags: ["fill", "empty"],
  numbers: ["w", "h"],
};
const directive = (type: DirectiveType, description: string, container: boolean): CatalogEntry => ({
  type,
  keywords: [type],
  description,
  container,
  content: true,
  flags: [],
  numbers: [],
  directive: true,
});

export const CATALOG: readonly CatalogEntry[] = [
  {
    type: "button",
    keywords: ["button", "btn"],
    description: "A button; a leading * makes it primary, an {icon} alone makes it square.",
    container: false,
    content: true,
    flags: ["fill", "round"],
    numbers: ["w", "h"],
  },
  {
    type: "dropdown",
    keywords: ["dropdown", "select", "combo", "combobox"],
    description: "A closed dropdown showing the starred (or first) of its | items.",
    container: false,
    content: true,
    flags: ["fill", "empty"],
    numbers: ["w"],
  },
  {
    type: "checkbox",
    keywords: ["checkbox", "check", "checkboxes"],
    description: "Checkboxes, one per | item: [x] checked, [ ] not.",
    container: false,
    content: true,
    flags: [],
    numbers: [],
  },
  {
    type: "text",
    keywords: ["text", "label"],
    description: "Plain text; each continuation line is another line.",
    container: false,
    content: true,
    flags: ["fill"],
    numbers: [],
  },
  {
    type: "grid",
    keywords: ["grid", "table", "datagrid"],
    description:
      "A table; one row per line, cells split on | (or commas), the first row the header.",
    container: false,
    content: true,
    flags: ["fill", "fit", "plain", "striped"],
    numbers: ["w"],
  },
  {
    type: "tabs",
    keywords: ["tabs", "tab"],
    description:
      "Tabs from | items, the starred one active, with a panel for the components under it.",
    container: true,
    content: true,
    flags: ["fill", "segmented", "underline"],
    numbers: ["w", "h"],
  },
  {
    type: "box",
    keywords: ["box", "panel", "group"],
    description: "A frame around the components under it, with an optional title bar.",
    container: true,
    content: true,
    flags: BOX_FLAGS,
    numbers: ["w", "h"],
  },
  {
    type: "row",
    keywords: ["row"],
    description: "The components under it side by side.",
    container: true,
    content: false,
    flags: ["fill", "top"],
    numbers: ["w"],
  },
  {
    type: "icon",
    keywords: ["icon"],
    description: "One icon by name.",
    container: false,
    content: true,
    flags: [],
    numbers: ["w"],
  },
  {
    type: "input",
    keywords: ["input", "textbox"],
    description: "A one-line text field; a trailing {icon} is a button at its end.",
    ...FIELD_LIKE,
  },
  {
    type: "search",
    keywords: ["search"],
    description: "A search field with a leading search icon.",
    ...FIELD_LIKE,
  },
  {
    type: "password",
    keywords: ["password"],
    description: "A password field; its text is masked.",
    ...FIELD_LIKE,
  },
  {
    type: "textarea",
    keywords: ["textarea"],
    description: "A multi-line text field.",
    container: false,
    content: true,
    flags: ["fill"],
    numbers: ["w", "h"],
  },
  {
    type: "h1",
    keywords: ["heading", "h1"],
    description: "A heading.",
    container: false,
    content: true,
    flags: ["fill"],
    numbers: [],
  },
  {
    type: "h2",
    keywords: ["h2", "subheading"],
    description: "A smaller heading.",
    container: false,
    content: true,
    flags: ["fill"],
    numbers: [],
  },
  {
    type: "columns",
    keywords: ["columns", "cols"],
    description: "The components under it side by side, all as tall as the tallest, touching.",
    container: true,
    content: false,
    flags: ["fill"],
    numbers: ["w", "h", "gap"],
  },
  {
    type: "nav",
    keywords: ["nav", "navigation"],
    description: "A vertical navigation list; * marks the active item, - a divider.",
    container: false,
    content: true,
    flags: ["fill", "dark"],
    numbers: ["w", "h"],
  },
  {
    type: "avatar",
    keywords: ["avatar"],
    description: "A circle with initials, or a user icon when empty.",
    container: false,
    content: true,
    flags: [],
    numbers: ["w"],
  },
  {
    type: "details",
    keywords: ["details", "properties"],
    description: "A detail list: one 'label | value' pair per line.",
    container: false,
    content: true,
    flags: ["fill", "stacked"],
    numbers: ["w"],
  },
  {
    type: "window",
    keywords: ["window"],
    description: "A desktop window with a title bar.",
    ...FRAME,
  },
  {
    type: "dialog",
    keywords: ["dialog", "modal"],
    description: "A dialog with a title bar, a close control and a shadow.",
    ...FRAME,
  },
  {
    type: "browser",
    keywords: ["browser"],
    description: "A browser window: 'title | address'.",
    ...FRAME,
  },
  {
    type: "phone",
    keywords: ["phone"],
    description: "A phone screen with a status bar and an optional app bar title.",
    ...FRAME,
  },
  {
    type: "buttons",
    keywords: ["buttons"],
    description: "Buttons from | items, side by side on the right, as in a dialog footer.",
    container: false,
    content: true,
    flags: ["fill"],
    numbers: ["w"],
  },
  {
    type: "link",
    keywords: ["link"],
    description: "A line of link text.",
    container: false,
    content: true,
    flags: ["fill"],
    numbers: [],
  },
  {
    type: "paragraph",
    keywords: ["paragraph", "p", "lorem"],
    description: "Wrapped text; empty or 'lorem' gives placeholder text.",
    container: false,
    content: true,
    flags: ["fill"],
    numbers: ["w", "lines"],
  },
  {
    type: "radio",
    keywords: ["radio", "radios", "option"],
    description: "Radio buttons, one per | item: * or (o) selects one.",
    container: false,
    content: true,
    flags: [],
    numbers: [],
  },
  {
    type: "toggle",
    keywords: ["toggle", "switch"],
    description: "Switches, one per | item: [on], [off] or * for on.",
    container: false,
    content: true,
    flags: [],
    numbers: [],
  },
  {
    type: "slider",
    keywords: ["slider", "range"],
    description: "A slider at a percentage: 'slider: 40%'.",
    container: false,
    content: true,
    flags: ["fill"],
    numbers: ["w"],
  },
  {
    type: "alert",
    keywords: ["alert", "message", "notice"],
    description: "A tinted message box.",
    container: false,
    content: true,
    flags: ["fill"],
    numbers: ["w", "h"],
  },
  {
    type: "progress",
    keywords: ["progress"],
    description: "A progress bar at a percentage; other text goes above it.",
    container: false,
    content: true,
    flags: ["fill"],
    numbers: ["w"],
  },
  {
    type: "tooltip",
    keywords: ["tooltip", "hint"],
    description: "A small dark box with a pointer.",
    container: false,
    content: true,
    flags: [],
    numbers: [],
  },
  {
    type: "image",
    keywords: ["image", "img", "picture"],
    description: "A crossed image placeholder: 'image: 320x180 Caption'.",
    container: false,
    content: true,
    flags: ["fill"],
    numbers: ["w", "h"],
  },
  {
    type: "placeholder",
    keywords: ["placeholder"],
    description:
      "A dashed box for something the syntax can't draw: 'placeholder: 240x40 Date picker'.",
    container: false,
    content: true,
    flags: ["fill"],
    numbers: ["w", "h"],
  },
  {
    type: "form",
    keywords: ["form"],
    description: "A box whose fields line up after one label column.",
    container: true,
    content: true,
    flags: BOX_FLAGS,
    numbers: ["w", "h", "label"],
  },
  {
    type: "field",
    keywords: ["field"],
    description:
      "A label before one component: 'field: Name | input: Anna'. Without the |, field: is an input.",
    container: false,
    content: true,
    flags: ["fill", "floating", "required"],
    numbers: [],
  },
  {
    type: "section",
    keywords: ["section"],
    description: "A header line with a count and a chevron over the components under it.",
    container: true,
    content: true,
    flags: ["fill", "collapsed"],
    numbers: ["w", "h", "count"],
  },
  {
    type: "breadcrumb",
    keywords: ["breadcrumb", "breadcrumbs", "crumbs"],
    description: "'Home > Users > Anna': links with chevrons; the starred or last is current.",
    container: false,
    content: true,
    flags: [],
    numbers: [],
  },
  {
    type: "pagination",
    keywords: ["pagination", "pager", "pages"],
    description: "'< 1 *2 3 … 10 >': a box per page, the starred one filled.",
    container: false,
    content: true,
    flags: [],
    numbers: [],
  },
  {
    type: "menu",
    keywords: ["menu", "contextmenu"],
    description: "A menu: one 'label | shortcut' item per line, - for a divider.",
    container: false,
    content: true,
    flags: ["fill"],
    numbers: ["w"],
  },
  {
    type: "tree",
    keywords: ["tree"],
    description: "A tree from indented lines: '+ name' closed, '- name' open, * selects.",
    container: false,
    content: true,
    flags: ["fill"],
    numbers: ["w"],
  },
  {
    type: "spin",
    keywords: ["spin", "number", "stepper"],
    description: "A number field with up and down arrows.",
    ...FIELD_LIKE,
  },
  directive("extends", "First line of a variant: the id of the screen it changes.", true),
  directive(
    "replace",
    "In a variant: replace the component with this id by the one under it.",
    true,
  ),
  directive("remove", "In a variant: remove the components with these ids.", false),
  directive("after", "In a variant: add the components under it after the one with this id.", true),
  directive(
    "before",
    "In a variant: add the components under it before the one with this id.",
    true,
  ),
  directive("rows", "In a variant: change, add or remove rows of the grid with this id.", false),
];

/** Every option a component takes, in the order an error lists them. */
export function optionsOf(entry: CatalogEntry): string[] {
  if (entry.directive) return [];
  return [...entry.numbers, ...entry.flags, ...COMMON_FLAGS];
}

/** The catalog entry of a node type. */
export function catalogEntry(type: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.type === type);
}
