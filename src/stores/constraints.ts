import { defineStore } from 'pinia'
import { ref } from 'vue'
import { constraintApi, type ConstraintData } from '../api/client'

export const useConstraintStore = defineStore('constraints', () => {
  const items = ref<ConstraintData[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetchAll = async () => {
    loading.value = true
    error.value = null
    try {
      items.value = await constraintApi.list()
    } catch (e: any) {
      error.value = e.message || 'Failed to fetch constraints'
    } finally {
      loading.value = false
    }
  }

  const create = async (data: ConstraintData) => {
    loading.value = true
    try {
      const created = await constraintApi.create(data)
      items.value.push(created)
      return created
    } catch (e: any) {
      error.value = e.message || 'Failed to create constraint'
      throw e
    } finally {
      loading.value = false
    }
  }

  const update = async (name: string, data: ConstraintData) => {
    loading.value = true
    try {
      const updated = await constraintApi.update(name, data)
      const index = items.value.findIndex(i => i.name === name)
      if (index !== -1) {
        items.value[index] = updated
      }
      return updated
    } catch (e: any) {
      error.value = e.message || 'Failed to update constraint'
      throw e
    } finally {
      loading.value = false
    }
  }

  const remove = async (name: string) => {
    loading.value = true
    try {
      await constraintApi.delete(name)
      items.value = items.value.filter(i => i.name !== name)
    } catch (e: any) {
      error.value = e.message || 'Failed to delete constraint'
      throw e
    } finally {
      loading.value = false
    }
  }

  return { items, loading, error, fetchAll, create, update, remove }
})
