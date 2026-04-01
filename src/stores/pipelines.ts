import { defineStore } from 'pinia'
import { ref } from 'vue'
import { pipelineApi, type PipelineData } from '../api/client'

export const usePipelineStore = defineStore('pipelines', () => {
  const items = ref<PipelineData[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetchAll = async () => {
    loading.value = true
    error.value = null
    try {
      items.value = await pipelineApi.list()
    } catch (e: any) {
      error.value = e.message || 'Failed to fetch pipelines'
    } finally {
      loading.value = false
    }
  }

  const create = async (data: PipelineData) => {
    loading.value = true
    try {
      const created = await pipelineApi.create(data)
      items.value.push(created)
      return created
    } catch (e: any) {
      error.value = e.message || 'Failed to create pipeline'
      throw e
    } finally {
      loading.value = false
    }
  }

  const update = async (name: string, data: PipelineData) => {
    loading.value = true
    try {
      const updated = await pipelineApi.update(name, data)
      const index = items.value.findIndex(i => i.name === name)
      if (index !== -1) {
        items.value[index] = updated
      }
      return updated
    } catch (e: any) {
      error.value = e.message || 'Failed to update pipeline'
      throw e
    } finally {
      loading.value = false
    }
  }

  const remove = async (name: string) => {
    loading.value = true
    try {
      await pipelineApi.delete(name)
      items.value = items.value.filter(i => i.name !== name)
    } catch (e: any) {
      error.value = e.message || 'Failed to delete pipeline'
      throw e
    } finally {
      loading.value = false
    }
  }

  return { items, loading, error, fetchAll, create, update, remove }
})
