import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import { zoomable } from "../src/zoom";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** A view over a stub SVG, with the view's box at (10, 20), 200 by 100. */
function view() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const element = zoomable(svg);
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    left: 10,
    top: 20,
    width: 200,
    height: 100,
  } as DOMRect);
  document.body.append(element);
  const click = (action: string) =>
    element.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.click();
  return { element, svg, click };
}

it("wraps the drawing with zoom-in, reset and zoom-out buttons", () => {
  const { element, svg } = view();
  expect(element.className).toBe("wiredown-view");
  expect(element.firstElementChild).toBe(svg);
  const buttons = [...element.querySelectorAll(".wiredown-controls > button")];
  expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
    "Zoom in",
    "Reset zoom",
    "Zoom out",
  ]);
  expect(buttons.every((b) => b.getAttribute("type") === "button")).toBe(true);
});

it("zooms about the view's center and resets to the fitted drawing", () => {
  const { element, svg, click } = view();
  click("zoom-in");
  // The center (100, 50) stays put: 100 - 1.2 * 100 = -20.
  expect(svg.style.transform).toBe("translate(-20px,-10px) scale(1.2)");
  expect(element.style.touchAction).toBe("none");
  click("zoom-out");
  // Back where it started, so the drawing is untransformed.
  expect(svg.style.transform).toBe("");
  click("zoom-in");
  click("reset");
  expect(svg.style.transform).toBe("");
  expect(element.style.touchAction).toBe("");
});

it("zooms toward the pointer with Ctrl or ⌘ and the wheel, and leaves a plain wheel to the page", () => {
  const { element, svg } = view();
  const wheel = (init: WheelEventInit) => {
    const event = new WheelEvent("wheel", { cancelable: true, ...init });
    // happy-dom leaves out the modifier keys and the position.
    for (const key of ["ctrlKey", "metaKey", "clientX", "clientY"] as const)
      Object.defineProperty(event, key, { value: init[key] ?? 0 });
    element.dispatchEvent(event);
    return event;
  };
  expect(wheel({ deltaY: -100 }).defaultPrevented).toBe(false);
  expect(svg.style.transform).toBe("");
  const zoomed = wheel({ deltaY: -300 * Math.log(2), ctrlKey: true, clientX: 10, clientY: 20 });
  expect(zoomed.defaultPrevented).toBe(true);
  // At the view's corner, so nothing moves but the scale.
  expect(svg.style.transform).toBe("translate(0px,0px) scale(2)");
  wheel({ deltaY: 100000, metaKey: true });
  expect(svg.style.transform).toMatch(/scale\(0\.25\)$/);
});

it("pans by dragging with a mouse, and with touch only once zoomed", () => {
  const { element, svg, click } = view();
  const pointer = (type: string, init: PointerEventInit) =>
    element.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init }),
    );
  pointer("pointerdown", { pointerType: "touch", clientX: 0, clientY: 0 });
  pointer("pointermove", { pointerType: "touch", clientX: 30, clientY: 40 });
  pointer("pointerup", { pointerType: "touch" });
  expect(svg.style.transform).toBe("");
  pointer("pointerdown", { pointerType: "mouse", clientX: 0, clientY: 0 });
  pointer("pointermove", { pointerType: "mouse", clientX: 30, clientY: 40 });
  pointer("pointerup", { pointerType: "mouse" });
  pointer("pointermove", { pointerType: "mouse", clientX: 90, clientY: 90 });
  expect(svg.style.transform).toBe("translate(30px,40px) scale(1)");
  click("reset");
  click("zoom-in");
  pointer("pointerdown", { pointerType: "touch", clientX: 0, clientY: 0 });
  pointer("pointermove", { pointerType: "touch", clientX: 5, clientY: 5 });
  expect(svg.style.transform).toBe("translate(-15px,-5px) scale(1.2)");
});

it("adds a fullscreen button where the page may go fullscreen, and resets on the change", () => {
  // happy-dom has no Fullscreen API.
  let fullscreen: Element | null = null;
  Object.defineProperty(document, "fullscreenEnabled", { value: true, configurable: true });
  Object.defineProperty(document, "fullscreenElement", {
    get: () => fullscreen,
    configurable: true,
  });
  onTestFinished(() => {
    for (const key of ["fullscreenEnabled", "fullscreenElement"])
      Reflect.deleteProperty(document, key);
  });
  const { element, svg, click } = view();
  element.requestFullscreen = vi.fn(async () => {
    fullscreen = element;
    element.dispatchEvent(new Event("fullscreenchange"));
  });
  document.exitFullscreen = vi.fn(async () => {
    fullscreen = null;
    element.dispatchEvent(new Event("fullscreenchange"));
  });
  click("zoom-in");
  click("fullscreen");
  expect(element.requestFullscreen).toHaveBeenCalled();
  expect(svg.style.transform).toBe("");
  click("exit-fullscreen");
  expect(document.exitFullscreen).toHaveBeenCalled();
  expect(element.querySelector('[data-action="fullscreen"]')!.getAttribute("aria-label")).toBe(
    "Fullscreen",
  );
});
