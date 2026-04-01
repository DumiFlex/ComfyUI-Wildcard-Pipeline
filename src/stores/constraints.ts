import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { constraintApi, type ConstraintData } from '../api/client'
import type { ConstraintBase, ConstraintDraft } from '../types'

export const useConstraintStore = defineStore('constraints', () => {
  const items = ref<ConstraintBase[]>([])
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
      items.value = await constraintApi.list() as ConstraintBase[]
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch constraints'
    } finally {
      loading.value = false
    }
  }

  const fetchCategories = async () => {
    loading.value = true
    error.value = null
    try {
      categories.value = await constraintApi.categories()
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch constraint categories'
    } finally {
      loading.value = false
    }
  }

  const fetchTags = async () => {
    loading.value = true
    error.value = null
    try {
      tags.value = await constraintApi.tags()
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch constraint tags'
    } finally {
      loading.value = false
    }
  }

  const create = async (data: ConstraintDraft) => {
    loading.value = true
    try {
      const created = await constraintApi.create(data) as ConstraintBase
      items.value.push(created)
      return created
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to create constraint'
      throw e
    } finally {
      loading.value = false
    }
  }

  const update = async (id: string, data: ConstraintData) => {
    loading.value = true
    try {
      const updated = await constraintApi.update(id, data)
      const index = items.value.findIndex(i => i.id === id)
      if (index !== -1) {
        items.value[index] = updated
      }
      return updated
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to update constraint'
      throw e
    } finally {
      loading.value = false
    }
  }

  const remove = async (id: string) => {
    loading.value = true
    try {
      await constraintApi.delete(id)
      items.value = items.value.filter(i => i.id !== id)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Failed to delete constraint'
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
