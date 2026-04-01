import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { pipelineApi, type PipelineData } from '../api/client'
import type { PipelineBase, PipelineDraft } from '../types'

export const usePipelineStore = defineStore('pipelines', () => {
  const items = ref<PipelineBase[]>([])
  const categories = ref<string[]>([])
  const tags = ref<string[]>([])
  const selectedCategory = ref<string | null>(null)
  const selectedTags = ref<string[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const filteredItems = computed(() => {
    return items.value.filter(item => {
      if (selectedCategory.value) {
        if (item.category !== selectedCategory.value) return false
      }

      if (selectedTags.value.length > 0) {
        if (!item.tags?.some(tag => selectedTags.value.includes(tag))) return false
      }

      return true
    })
  })

  const totalCount = computed(() => items.value.length)

  const categoryCounts = computed(() => {
    const counts: Record<string, number> = {}
    items.value.forEach(item => {
      const cat = item.category ?? ''
      counts[cat] = (counts[cat] ?? 0) + 1
    })
    return counts
  })

  const fetchAll = async () => {
    loading.value = true
    error.value = null
    try {
      items.value = await pipelineApi.list() as PipelineBase[]
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch pipelines'
    } finally {
      loading.value = false
    }
  }

  const fetchCategories = async () => {
    loading.value = true
    error.value = null
    try {
      categories.value = await pipelineApi.categories()
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch pipeline categories'
    } finally {
      loading.value = false
    }
  }

  const fetchTags = async () => {
    loading.value = true
    error.value = null
    try {
      tags.value = await pipelineApi.tags()
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch pipeline tags'
    } finally {
      loading.value = false
    }
  }

  const create = async (data: PipelineDraft) => {
    loading.value = true
    try {
      const created = await pipelineApi.create(data) as PipelineBase
      items.value.push(created)
      return created
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to create pipeline'
      throw e
    } finally {
      loading.value = false
    }
  }

  const update = async (id: string, data: PipelineData) => {
    loading.value = true
    try {
      const updated = await pipelineApi.update(id, data)
      const index = items.value.findIndex(i => i.id === id)
      if (index !== -1) {
        items.value[index] = updated
      }
      return updated
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to update pipeline'
      throw e
    } finally {
      loading.value = false
    }
  }

  const remove = async (id: string) => {
    loading.value = true
    try {
      await pipelineApi.delete(id)
      items.value = items.value.filter(i => i.id !== id)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to delete pipeline'
      throw e
    } finally {
      loading.value = false
    }
  }

  return {
    items,
    categories,
    tags,
    selectedCategory,
    selectedTags,
    loading,
    error,
    filteredItems,
    totalCount,
    categoryCounts,
    fetchAll,
    fetchCategories,
    fetchTags,
    create,
    update,
    remove,
  }
})
