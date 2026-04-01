import { defineStore } from 'pinia'
import { ref } from 'vue'
import { wildcardApi, type WildcardData } from '../api/client'

export const useWildcardStore = defineStore('wildcards', () => {
  const items = ref<WildcardData[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetchAll = async () => {
    loading.value = true
    error.value = null
    try {
      items.value = await wildcardApi.list()
    } catch (e: any) {
      error.value = e.message || 'Failed to fetch wildcards'
    } finally {
      loading.value = false
    }
  }

  const create = async (data: WildcardData) => {
    loading.value = true
    try {
      const created = await wildcardApi.create(data)
      items.value.push(created)
      return created
    } catch (e: any) {
      error.value = e.message || 'Failed to create wildcard'
      throw e
    } finally {
      loading.value = false
    }
  }

  const update = async (name: string, data: WildcardData) => {
    loading.value = true
    try {
      const updated = await wildcardApi.update(name, data)
      const index = items.value.findIndex(i => i.name === name)
      if (index !== -1) {
        items.value[index] = updated
      }
      return updated
    } catch (e: any) {
      error.value = e.message || 'Failed to update wildcard'
      throw e
    } finally {
      loading.value = false
    }
  }

  const remove = async (name: string) => {
    loading.value = true
    try {
      await wildcardApi.delete(name)
      items.value = items.value.filter(i => i.name !== name)
    } catch (e: any) {
      error.value = e.message || 'Failed to delete wildcard'
      throw e
    } finally {
      loading.value = false
    }
  }

  return { items, loading, error, fetchAll, create, update, remove }
})
