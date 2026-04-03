import type { PipelineModule } from "@/types";

function isValidIndex(modules: PipelineModule[], index: number): boolean {
  return index >= 0 && index < modules.length;
}

export function moveModule(modules: PipelineModule[], fromIndex: number, toIndex: number): PipelineModule[] {
  if (
    fromIndex === toIndex ||
    !isValidIndex(modules, fromIndex) ||
    !isValidIndex(modules, toIndex)
  ) {
    return [...modules];
  }

  const nextModules = [...modules];
  const [movedModule] = nextModules.splice(fromIndex, 1);
  nextModules.splice(toIndex, 0, movedModule);
  return nextModules;
}

export function moveModuleUp(modules: PipelineModule[], index: number): PipelineModule[] {
  if (index <= 0) {
    return [...modules];
  }
  return moveModule(modules, index, index - 1);
}

export function moveModuleDown(modules: PipelineModule[], index: number): PipelineModule[] {
  if (index >= modules.length - 1) {
    return [...modules];
  }
  return moveModule(modules, index, index + 1);
}

export function moveModuleToTop(modules: PipelineModule[], index: number): PipelineModule[] {
  if (index <= 0) {
    return [...modules];
  }
  return moveModule(modules, index, 0);
}

export function moveModuleToBottom(modules: PipelineModule[], index: number): PipelineModule[] {
  if (index >= modules.length - 1) {
    return [...modules];
  }
  return moveModule(modules, index, modules.length - 1);
}

export function duplicateModule(modules: PipelineModule[], index: number): PipelineModule[] {
  if (!isValidIndex(modules, index)) {
    return [...modules];
  }

  const clone = JSON.parse(JSON.stringify(modules[index])) as PipelineModule;
  delete (clone as { __dismissed_conflicts?: unknown }).__dismissed_conflicts;

  const nextModules = [...modules];
  nextModules.splice(index + 1, 0, clone);
  return nextModules;
}

export function insertModuleAt(modules: PipelineModule[], module: PipelineModule, atIndex: number): PipelineModule[] {
  const clone = JSON.parse(JSON.stringify(module)) as PipelineModule;
  delete (clone as { __dismissed_conflicts?: unknown }).__dismissed_conflicts;

  const nextModules = [...modules];
  const index = atIndex < 0 ? 0 : atIndex >= modules.length ? modules.length : atIndex;
  nextModules.splice(index, 0, clone);
  return nextModules;
}

export function removeModuleAt(modules: PipelineModule[], index: number): PipelineModule[] {
  if (!isValidIndex(modules, index)) {
    return [...modules];
  }

  const nextModules = [...modules];
  nextModules.splice(index, 1);
  return nextModules;
}
