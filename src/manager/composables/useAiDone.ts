/**
 * Tell the user an AI job finished while its view was away.
 *
 * - The view is on screen and the tab is visible: nothing (they see it).
 * - The view is away (another page, the chat drawer closed): a kit toast
 *   with **Open**, which takes them there.
 * - The tab is hidden: a dot in front of the tab title until the tab is
 *   shown again and, when Settings › AI › Chat › Notify when AI work
 *   finishes is on and the browser allows it, a system notification whose
 *   click focuses the tab and opens the view.
 *
 * Research: /pr-drafts/ai-job-done-notice-2026-11-24.md.
 */
import { ref } from "vue";
import type { Router, RouteLocationRaw } from "vue-router";
import { useToast, type ToastSeverity } from "@/kit/useToast";

export type AiJob = "pack" | "chat";

export interface AiDoneNotice {
  /** One kind per job: a new notice replaces the old one of its kind. */
  job: AiJob;
  summary: string;
  detail?: string | undefined;
  severity?: ToastSeverity | undefined;
  /** Whether the job's view is on screen in this tab right now. */
  shown: () => boolean;
  /** Bring the view back (open the page, open the drawer). */
  open: () => void | Promise<void>;
}

const STORAGE_KEY = "wp-ai-done-desktop";
/** How long the toast stays (it carries a button, so longer than the default). */
export const DONE_TOAST_LIFE = 10_000;
/** What goes in front of the tab title while a finished job waits. */
export const TITLE_MARK = "● ";

function readStored(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
}

/** The "Notify when AI work finishes" setting (this browser only). */
const desktop = ref(readStored());

let router: Router | null = null;
/** Give the notices the app's router, for Open (from `main.ts`). */
export function setAiDoneRouter(r: Router): void {
  router = r;
}
/** Go to a page from a notice; nothing before the router is set (tests). */
export function goTo(to: RouteLocationRaw): void {
  void router?.push(to);
}

/** The notification API this tab can use, or null (missing, or not a
 *  secure context such as ComfyUI opened over a LAN address). */
function notificationApi(): typeof Notification | null {
  if (typeof window === "undefined" || !("Notification" in window)) return null;
  if (window.isSecureContext === false) return null;
  return window.Notification;
}

/** Why system notifications can't be used here, or "" when they can. */
export function desktopBlocked(): string {
  const api = notificationApi();
  if (!api) {
    return typeof window !== "undefined" && window.isSecureContext === false
      ? "Your browser only allows notifications on a secure address (https, or localhost / 127.0.0.1). This page is not on one."
      : "This browser has no notifications.";
  }
  if (api.permission === "denied") return "The browser blocks notifications for this page. Allow them in its site settings, then turn this on again.";
  return "";
}

function store(v: boolean): void {
  desktop.value = v;
  try { localStorage.setItem(STORAGE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
}

/** Turn system notifications on or off. Turning on asks the browser (so
 *  call it from a click); returns why it stayed off, or "". */
export async function setAiDoneDesktop(on: boolean): Promise<string> {
  if (!on) {
    store(false);
    return "";
  }
  const api = notificationApi();
  if (!api) {
    store(false);
    return desktopBlocked();
  }
  let perm = api.permission;
  if (perm === "default") {
    try { perm = await api.requestPermission(); } catch { perm = "denied"; }
  }
  if (perm !== "granted") {
    store(false);
    return desktopBlocked() || "The browser didn't allow notifications.";
  }
  store(true);
  return "";
}

/* ── tab title mark ─────────────────────────────────────────────────── */

let marked = false;

function clearMark(): void {
  if (!marked || typeof document === "undefined") return;
  if (document.title.startsWith(TITLE_MARK)) document.title = document.title.slice(TITLE_MARK.length);
  marked = false;
}

function onVisible(): void {
  if (document.visibilityState === "visible") clearMark();
}

function mark(): void {
  if (typeof document === "undefined") return;
  if (!marked) {
    document.title = TITLE_MARK + document.title;
    marked = true;
  }
  document.addEventListener("visibilitychange", onVisible);
}

function tabHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** Notifications still open, by job, so a new one replaces it. */
const open = new Map<AiJob, Notification>();

function systemNotice(n: AiDoneNotice): void {
  const api = notificationApi();
  if (!desktop.value || !api || api.permission !== "granted") return;
  try {
    open.get(n.job)?.close();
    const note = new api(n.summary, {
      ...(n.detail ? { body: n.detail } : {}),
      tag: `wp-ai-${n.job}`,
    });
    note.onclick = () => {
      window.focus();
      void n.open();
      note.close();
    };
    note.onclose = () => {
      if (open.get(n.job) === note) open.delete(n.job);
    };
    open.set(n.job, note);
  } catch { /* some browsers only allow notifications from a service worker */ }
}

const toastIds = new Map<AiJob, string>();

/** Say a job finished, as much as the view's place calls for. */
export function aiDone(n: AiDoneNotice): void {
  const hidden = tabHidden();
  const shown = n.shown();
  if (shown && !hidden) return;
  if (!shown) {
    const toast = useToast();
    const old = toastIds.get(n.job);
    if (old) toast.dismiss(old);
    toastIds.set(n.job, toast.push({
      severity: n.severity ?? "success",
      summary: n.summary,
      ...(n.detail ? { detail: n.detail } : {}),
      life: DONE_TOAST_LIFE,
      action: { label: "Open", run: n.open },
    }));
  }
  if (hidden) {
    mark();
    systemNotice(n);
  }
}

export function useAiDone() {
  return { desktop, setAiDoneDesktop, desktopBlocked };
}

export function _resetAiDoneForTests(): void {
  clearMark();
  open.clear();
  toastIds.clear();
  desktop.value = readStored();
  router = null;
}
