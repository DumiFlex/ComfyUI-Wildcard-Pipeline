import { mount, type VueWrapper } from "@vue/test-utils";
import type { Component } from "vue";
import type { ModuleEntry } from "../../../../widgets/_shared";

export interface SectionTestProps<L = unknown, M = unknown> {
  library: L;
  modelValue: M | null;
  siblingModules?: ModuleEntry[];
}

/** Standard mount harness for instance section components. Provides default
 *  empty siblings list so tests don't have to. */
export function renderSection<L, M>(
  Component: Component,
  props: SectionTestProps<L, M>,
): VueWrapper {
  return mount(Component, {
    props: { siblingModules: [], ...props },
  });
}

export function getEmittedUpdate<M>(wrapper: VueWrapper): M | null | undefined {
  const events = wrapper.emitted("update:modelValue");
  if (!events || events.length === 0) return undefined;
  return events[events.length - 1]?.[0] as M | null | undefined;
}

export function emittedReset(wrapper: VueWrapper): boolean {
  return (wrapper.emitted("reset") ?? []).length > 0;
}
