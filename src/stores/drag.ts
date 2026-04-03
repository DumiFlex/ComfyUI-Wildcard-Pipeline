import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { PipelineModule } from '@/types'

function cloneModule(module: PipelineModule): PipelineModule {
  return JSON.parse(JSON.stringify(module)) as PipelineModule
}

export const useDragStore = defineStore('wp-drag', () => {
  const sourceNodeId = ref<number | null>(null)
  const sourceIndex = ref<number | null>(null)
  const module = ref<PipelineModule | null>(null)
  const removeFromSource = ref<(() => void) | null>(null)

  const isDragging = computed(() => sourceNodeId.value !== null)

  const reset = () => {
    sourceNodeId.value = null
    sourceIndex.value = null
    module.value = null
    removeFromSource.value = null
  }

  const startDrag = (
    nodeId: number,
    index: number,
    draggedModule: PipelineModule,
    removeCallback: () => void,
  ): void => {
    sourceNodeId.value = nodeId
    sourceIndex.value = index
    module.value = cloneModule(draggedModule)
    removeFromSource.value = removeCallback
  }

  const completeDrop = (): void => {
    if (!isDragging.value) return

    try {
      removeFromSource.value?.()
    } catch {
    }

    reset()
  }

  const cancelDrag = (): void => {
    reset()
  }

  return {
    sourceNodeId,
    sourceIndex,
    module,
    removeFromSource,
    isDragging,
    startDrag,
    completeDrop,
    cancelDrag,
  }
})
