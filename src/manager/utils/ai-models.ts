/**
 * How the model pickers mark each model: a green dot for one the server
 * has in memory now (Ollama `/api/ps`, LM Studio, llama.cpp's router, a
 * launcher's `/v1/model-status`), a hollow grey one for one it would have to
 * load first. A server that doesn't say keeps the old marks: green for a
 * local server, amber for a cloud one.
 */
export interface ModelMark { dot: string; meta?: string; title?: string }

export function modelState(name: string, local: boolean, loaded: string[] | null): ModelMark {
  if (!local) return { dot: "var(--wp-warn)" };
  if (!loaded) return { dot: "var(--wp-success)" };
  return loaded.includes(name)
    ? { dot: "var(--wp-success)", meta: "loaded", title: "In memory now: answers start straight away" }
    : { dot: "var(--wp-text-dim)", title: "Not loaded: the server loads it first, which takes a while" };
}
