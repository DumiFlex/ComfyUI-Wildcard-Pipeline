/* The tutorial overlay, added to every page before it loads (Playwright addInitScript).
 * Plain JS: it runs in the page, not in the build.
 *
 * - A steady pointer that follows the mouse Playwright moves (real DOM events, so it follows
 *   clicks, hovers and canvas drags) and a ring where the button goes down. It never fades.
 * - A caption bar at the bottom for the narration line.
 * - A callout: a box around a part of the screen with a short label.
 *
 * Everything is pointer-events: none and sits above the app, so it never takes a click. */
(() => {
  if (window.__tut) return;
  const Z = "2147483647";
  const ARROW =
    '<svg width="20" height="25" viewBox="0 0 26 32" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M2 2 L2 26 L8.5 20 L13 30 L17.5 28 L13 18.5 L22 18.5 Z" fill="#fff" stroke="#111" stroke-width="1.8" stroke-linejoin="round"/></svg>';

  let root = null;
  let pointer = null;
  let caption = null;
  const callouts = new Map();
  let x = -100;
  let y = -100;

  function layer() {
    if (root && root.isConnected) return root;
    if (!document.body) return null;
    root = document.createElement("div");
    root.setAttribute("data-tut", "layer");
    root.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${Z};`;
    pointer = document.createElement("div");
    pointer.style.cssText = "position:absolute;left:0;top:0;width:20px;height:25px;transform:translate(-100px,-100px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));will-change:transform;";
    pointer.innerHTML = ARROW;
    caption = document.createElement("div");
    caption.style.cssText =
      "position:absolute;left:50%;bottom:44px;transform:translateX(-50%);max-width:min(1400px,calc(100% - 120px));" +
      "padding:14px 26px;border-radius:12px;background:rgba(12,12,16,.86);color:#fff;" +
      "font:600 30px/1.35 'Inter','Segoe UI',system-ui,sans-serif;text-align:center;letter-spacing:.005em;" +
      "box-shadow:0 6px 24px rgba(0,0,0,.4);opacity:0;transition:opacity .25s ease;";
    root.append(caption, pointer);
    document.body.appendChild(root);
    place();
    return root;
  }

  function place() {
    if (pointer) pointer.style.transform = `translate(${x - 2}px,${y - 2}px)`;
  }

  function ring(px, py) {
    const r = layer();
    if (!r) return;
    const el = document.createElement("div");
    el.style.cssText =
      `position:absolute;left:${px - 14}px;top:${py - 14}px;width:28px;height:28px;border-radius:50%;` +
      "border:3px solid rgba(124,108,255,.95);background:rgba(124,108,255,.22);transform:scale(.4);opacity:1;" +
      "transition:transform .35s ease-out,opacity .45s ease-out;";
    r.insertBefore(el, pointer);
    requestAnimationFrame(() => {
      el.style.transform = "scale(1.25)";
      el.style.opacity = "0";
    });
    setTimeout(() => el.remove(), 600);
  }

  const move = (e) => {
    x = e.clientX;
    y = e.clientY;
    layer();
    place();
  };
  // Capture phase on window: the canvas and dialogs stop some events from bubbling.
  window.addEventListener("pointermove", move, true);
  window.addEventListener("mousemove", move, true);
  window.addEventListener("pointerdown", (e) => {
    move(e);
    ring(e.clientX, e.clientY);
  }, true);
  // A page that rebuilds its body (a route change) drops the layer: put it back.
  setInterval(() => {
    if (root && !root.isConnected && document.body) document.body.appendChild(root);
  }, 400);

  window.__tut = {
    /** A magenta square in the top-right corner for a moment: render.mjs finds it to line the voice up with the video. */
    mark(ms) {
      const r = layer();
      if (!r) return;
      const m = document.createElement("div");
      m.style.cssText = "position:absolute;right:0;top:0;width:16px;height:16px;background:#ff00ff;";
      r.appendChild(m);
      setTimeout(() => m.remove(), ms);
    },
    caption(text) {
      layer();
      if (!caption) return;
      if (!text) {
        caption.style.opacity = "0";
        return;
      }
      caption.textContent = text;
      caption.style.opacity = "1";
    },
    callout(id, rect, label) {
      const r = layer();
      if (!r) return;
      this.uncallout(id);
      const box = document.createElement("div");
      const pad = 8;
      box.style.cssText =
        `position:absolute;left:${rect.x - pad}px;top:${rect.y - pad}px;width:${rect.width + pad * 2}px;height:${rect.height + pad * 2}px;` +
        "border:3px solid #7c6cff;border-radius:12px;box-shadow:0 0 0 9999px rgba(0,0,0,.28),0 0 18px rgba(124,108,255,.7);" +
        "opacity:0;transition:opacity .3s ease;";
      if (label) {
        const tag = document.createElement("div");
        tag.textContent = label;
        const above = rect.y > 70;
        tag.style.cssText =
          `position:absolute;left:-3px;${above ? "bottom:calc(100% + 8px)" : "top:calc(100% + 8px)"};white-space:nowrap;` +
          "padding:6px 14px;border-radius:8px;background:#7c6cff;color:#fff;font:600 22px/1.3 'Inter','Segoe UI',system-ui,sans-serif;";
        box.appendChild(tag);
      }
      r.insertBefore(box, caption);
      requestAnimationFrame(() => (box.style.opacity = "1"));
      callouts.set(id, box);
    },
    /** Moves a callout to a new rect (its part moved or changed size). */
    recallout(id, rect) {
      const box = callouts.get(id);
      if (!box) return;
      const pad = 8;
      box.style.left = `${rect.x - pad}px`;
      box.style.top = `${rect.y - pad}px`;
      box.style.width = `${rect.width + pad * 2}px`;
      box.style.height = `${rect.height + pad * 2}px`;
    },
    uncallout(id) {
      const old = callouts.get(id);
      if (!old) return;
      callouts.delete(id);
      old.style.opacity = "0";
      setTimeout(() => old.remove(), 320);
    },
    clear() {
      for (const id of [...callouts.keys()]) this.uncallout(id);
      this.caption("");
    },
  };
  document.addEventListener("DOMContentLoaded", () => layer());
})();
