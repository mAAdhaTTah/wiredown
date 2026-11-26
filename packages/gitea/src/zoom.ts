// Zoom, pan and fullscreen for a drawn flow, after Gitea's Mermaid viewer:
// buttons zoom by a step, Ctrl/⌘ and the wheel (or a trackpad pinch) zoom
// toward the pointer, and dragging pans. Reset returns to the drawing fitted
// to its box: the page width, or the screen in fullscreen.

/** Octicons (MIT), 16px. */
const ICONS = {
  "zoom-in":
    "M3.75 7.5a.75.75 0 0 1 .75-.75h2.25V4.5a.75.75 0 0 1 1.5 0v2.25h2.25a.75.75 0 0 1 0 1.5H8.25v2.25a.75.75 0 0 1-1.5 0V8.25H4.5a.75.75 0 0 1-.75-.75ZM7.5 0a7.5 7.5 0 0 1 5.807 12.247l2.473 2.473a.749.749 0 1 1-1.06 1.06l-2.473-2.473A7.5 7.5 0 1 1 7.5 0Zm-6 7.5a6 6 0 1 0 12 0 6 6 0 0 0-12 0Z",
  reset:
    "M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z",
  "zoom-out":
    "M4.5 6.75h6a.75.75 0 0 1 0 1.5h-6a.75.75 0 0 1 0-1.5ZM0 7.5a7.5 7.5 0 1 1 13.307 4.747l2.473 2.473a.749.749 0 1 1-1.06 1.06l-2.473-2.473A7.5 7.5 0 0 1 0 7.5Zm7.5-6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z",
  fullscreen:
    "M1.75 10a.75.75 0 0 1 .75.75v2.5c0 .138.112.25.25.25h2.5a.75.75 0 0 1 0 1.5h-2.5A1.75 1.75 0 0 1 1 13.25v-2.5a.75.75 0 0 1 .75-.75Zm12.5 0a.75.75 0 0 1 .75.75v2.5A1.75 1.75 0 0 1 13.25 15h-2.5a.75.75 0 0 1 0-1.5h2.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 .75-.75ZM2.75 2.5a.25.25 0 0 0-.25.25v2.5a.75.75 0 0 1-1.5 0v-2.5C1 1.784 1.784 1 2.75 1h2.5a.75.75 0 0 1 0 1.5ZM10 1.75a.75.75 0 0 1 .75-.75h2.5c.966 0 1.75.784 1.75 1.75v2.5a.75.75 0 0 1-1.5 0v-2.5a.25.25 0 0 0-.25-.25h-2.5a.75.75 0 0 1-.75-.75Z",
  "exit-fullscreen":
    "M10.75 1a.75.75 0 0 1 .75.75v2.5c0 .138.112.25.25.25h2.5a.75.75 0 0 1 0 1.5h-2.5A1.75 1.75 0 0 1 10 4.25v-2.5a.75.75 0 0 1 .75-.75Zm-5.5 0a.75.75 0 0 1 .75.75v2.5A1.75 1.75 0 0 1 4.25 6h-2.5a.75.75 0 0 1 0-1.5h2.5a.25.25 0 0 0 .25-.25v-2.5A.75.75 0 0 1 5.25 1ZM1 10.75a.75.75 0 0 1 .75-.75h2.5c.966 0 1.75.784 1.75 1.75v2.5a.75.75 0 0 1-1.5 0v-2.5a.25.25 0 0 0-.25-.25h-2.5a.75.75 0 0 1-.75-.75Zm9 1c0-.966.784-1.75 1.75-1.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.25.25 0 0 0-.25.25v2.5a.75.75 0 0 1-1.5 0Z",
};
type Action = keyof typeof ICONS;
const LABELS: Record<Action, string> = {
  "zoom-in": "Zoom in",
  reset: "Reset zoom",
  "zoom-out": "Zoom out",
  fullscreen: "Fullscreen",
  "exit-fullscreen": "Exit fullscreen",
};

export const ZOOM_STYLE = `.wiredown-view{position:relative;overflow:hidden}
.wiredown-view>.wiredown-svg{transform-origin:0 0}
.wiredown-view:fullscreen{background:var(--color-body,Canvas)}
.wiredown-view:fullscreen>.wiredown-svg{width:100%;height:100%;max-width:none}
.wiredown-controls{position:absolute;right:6px;bottom:5px;display:flex;gap:4px;visibility:hidden;opacity:0;transition:opacity .2s}
.wiredown-view:hover>.wiredown-controls,.wiredown-view:focus-within>.wiredown-controls,.wiredown-view:fullscreen>.wiredown-controls{visibility:visible;opacity:1}
@media (hover:none){.wiredown-controls{visibility:visible;opacity:1}}
.wiredown-controls svg{display:block;fill:currentColor}`;

const STEP = 1.2;
const MIN = 0.25;
const MAX = 16;

function setIcon(button: HTMLButtonElement, action: Action) {
  const document = button.ownerDocument;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [name, value] of [
    ["viewBox", "0 0 16 16"],
    ["width", "12"],
    ["height", "12"],
    ["aria-hidden", "true"],
  ])
    svg.setAttribute(name, value!);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[action]);
  svg.append(path);
  button.replaceChildren(svg);
  button.dataset.action = action;
  button.title = LABELS[action];
  button.setAttribute("aria-label", LABELS[action]);
}

/** Wraps a drawn SVG in a box that clips it, with the controls over it. */
export function zoomable(svg: SVGSVGElement): HTMLElement {
  const document = svg.ownerDocument;
  const view = document.createElement("div");
  view.className = "wiredown-view";
  view.append(svg);
  const controls = document.createElement("div");
  controls.className = "wiredown-controls";
  view.append(controls);

  let scale = 1;
  let x = 0;
  let y = 0;
  const apply = () => {
    svg.style.transform = scale === 1 && !x && !y ? "" : `translate(${x}px,${y}px) scale(${scale})`;
    // Touch scrolls the page until the drawing is zoomed, then pans it.
    view.style.touchAction = scale === 1 ? "" : "none";
  };
  const reset = () => {
    scale = 1;
    x = y = 0;
    apply();
  };
  /** Zooms by a factor, keeping the given client point still. */
  const zoom = (factor: number, clientX?: number, clientY?: number) => {
    const next = Math.min(MAX, Math.max(MIN, scale * factor));
    const box = view.getBoundingClientRect();
    // The point relative to the SVG's untransformed corner, which is at the
    // view's corner: the SVG is the view's first child, at its top left.
    const px = (clientX ?? box.left + box.width / 2) - box.left;
    const py = (clientY ?? box.top + box.height / 2) - box.top;
    x = px - (next / scale) * (px - x);
    y = py - (next / scale) * (py - y);
    scale = next;
    apply();
  };

  const button = (action: Action) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "ui tiny compact icon button";
    setIcon(element, action);
    controls.append(element);
    return element;
  };
  button("zoom-in").addEventListener("click", () => zoom(STEP));
  button("reset").addEventListener("click", reset);
  button("zoom-out").addEventListener("click", () => zoom(1 / STEP));
  if (document.fullscreenEnabled) {
    const full = button("fullscreen");
    full.addEventListener("click", () => {
      if (document.fullscreenElement === view) void document.exitFullscreen();
      else void view.requestFullscreen();
    });
    // The fitted size changes, so the zoom starts again.
    view.addEventListener("fullscreenchange", () => {
      setIcon(full, document.fullscreenElement === view ? "exit-fullscreen" : "fullscreen");
      reset();
    });
  }

  view.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      zoom(Math.exp(-delta / 300), event.clientX, event.clientY);
    },
    { passive: false },
  );

  let dragging: number | undefined;
  let lastX = 0;
  let lastY = 0;
  view.addEventListener("pointerdown", (event) => {
    if (dragging !== undefined || event.button !== 0) return;
    if (event.pointerType !== "mouse" && scale === 1) return;
    if ((event.target as Element).closest("a, button")) return;
    event.preventDefault(); // no text selection while dragging
    dragging = event.pointerId;
    view.setPointerCapture?.(event.pointerId);
    lastX = event.clientX;
    lastY = event.clientY;
    view.style.cursor = "grabbing";
  });
  view.addEventListener("pointermove", (event) => {
    if (event.pointerId !== dragging) return;
    x += event.clientX - lastX;
    y += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    apply();
  });
  const end = (event: PointerEvent) => {
    if (event.pointerId !== dragging) return;
    dragging = undefined;
    view.style.removeProperty("cursor");
  };
  view.addEventListener("pointerup", end);
  view.addEventListener("pointercancel", end);
  return view;
}
