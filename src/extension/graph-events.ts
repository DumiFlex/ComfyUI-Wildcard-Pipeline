// Vanilla-JS event registry shared between main.ts (publisher) and the Vue
// widget chunks (subscribers). Lives in its own module so importing it from
// main.ts doesn't drag Vue into the entry bundle.

const graphLoadListeners = new Set<() => void>();

export function onGraphLoaded(listener: () => void): () => void {
  graphLoadListeners.add(listener);
  return () => graphLoadListeners.delete(listener);
}

export function notifyGraphLoaded(): void {
  for (const fn of graphLoadListeners) fn();
}
