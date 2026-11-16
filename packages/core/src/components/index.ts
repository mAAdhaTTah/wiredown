import type { Component, NodeType } from "../types.js";
import { avatar } from "./avatar.js";
import { box } from "./box.js";
import { button } from "./button.js";
import { checkbox } from "./checkbox.js";
import { columns } from "./columns.js";
import { radio, slider, toggle } from "./controls.js";
import { details } from "./details.js";
import { dropdown } from "./dropdown.js";
import { alert, image, placeholder, progress, tooltip } from "./feedback.js";
import { field, form } from "./form.js";
import { section } from "./section.js";
import { browser, buttons, dialog, phone, windowFrame } from "./frames.js";
import { grid } from "./grid.js";
import { heading } from "./heading.js";
import { icon } from "./icon.js";
import { input, spin, textarea } from "./input.js";
import { link } from "./link.js";
import { nav } from "./nav.js";
import { breadcrumb, menu, pagination, tree } from "./navigation.js";
import { paragraph } from "./paragraph.js";
import { row } from "./row.js";
import { tabs } from "./tabs.js";
import { text } from "./text.js";

const root: Component = (ctx, node, x, y) => ctx.stack(node.children, x, y, ctx.theme.gap.root);
/** Variant directives are resolved before layout; one that is left over draws nothing. */
const nothing: Component = () => ({ w: 0, h: 0 });

export const COMPONENTS: Record<NodeType, Component> = {
  root,
  row,
  box,
  tabs,
  text,
  button,
  dropdown,
  checkbox,
  grid,
  icon,
  input,
  search: input,
  password: input,
  textarea,
  h1: heading,
  h2: heading,
  columns,
  nav,
  avatar,
  details,
  window: windowFrame,
  dialog,
  browser,
  phone,
  buttons,
  link,
  paragraph,
  radio,
  toggle,
  slider,
  alert,
  progress,
  tooltip,
  image,
  breadcrumb,
  pagination,
  menu,
  tree,
  placeholder,
  form,
  field,
  section,
  spin,
  extends: nothing,
  remove: nothing,
  after: nothing,
  before: nothing,
  rows: nothing,
};
