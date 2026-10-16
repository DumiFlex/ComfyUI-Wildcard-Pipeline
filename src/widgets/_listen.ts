// Kept out of _shared.ts: the manager build imports _shared.ts and has no
// `#comfyui/app` to resolve.
import { app as comfyApp } from "#comfyui/app";

import type { DomWidgetHost } from "./_shared";

type ApiListener = (e: Event) => void;
interface ApiLike {
  addEventListener?: (n: string, fn: ApiListener) => void;
  removeEventListener?: (n: string, fn: ApiListener) => void;
}

/** Subscribe to a ComfyUI `api` event for the host's lifetime. */
export function listenApi(host: Pick<DomWidgetHost, "onCleanup">, event: string, fn: ApiListener): void {
  const api = (comfyApp as unknown as { api?: ApiLike }).api;
  if (!api?.addEventListener) return;
  api.addEventListener(event, fn);
  host.onCleanup(() => api.removeEventListener?.(event, fn));
}
