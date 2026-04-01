import axios from 'axios'
import type { WildcardOption, ConstraintRule, PipelineModule } from '../types'

const api = axios.create({ baseURL: '/wp/api' })

export interface WildcardData {
  name: string
  version: number
  options: WildcardOption[]
}

export interface ConstraintData {
  name: string
  rules: ConstraintRule[]
}

export interface PipelineData {
  name: string
  version: number
  modules: PipelineModule[]
}

export const wildcardApi = {
  list: () => api.get<WildcardData[]>('/wildcards').then(r => r.data),
  get: (name: string) => api.get<WildcardData>(`/wildcards/${name}`).then(r => r.data),
  create: (data: WildcardData) => api.post('/wildcards', data).then(r => r.data),
  update: (name: string, data: WildcardData) => api.put(`/wildcards/${name}`, data).then(r => r.data),
  delete: (name: string) => api.delete(`/wildcards/${name}`).then(r => r.data)
}

export const constraintApi = {
  list: () => api.get<ConstraintData[]>('/constraints').then(r => r.data),
  get: (name: string) => api.get<ConstraintData>(`/constraints/${name}`).then(r => r.data),
  create: (data: ConstraintData) => api.post('/constraints', data).then(r => r.data),
  update: (name: string, data: ConstraintData) => api.put(`/constraints/${name}`, data).then(r => r.data),
  delete: (name: string) => api.delete(`/constraints/${name}`).then(r => r.data)
}

export const pipelineApi = {
  list: () => api.get<PipelineData[]>('/pipelines').then(r => r.data),
  get: (name: string) => api.get<PipelineData>(`/pipelines/${name}`).then(r => r.data),
  create: (data: PipelineData) => api.post('/pipelines', data).then(r => r.data),
  update: (name: string, data: PipelineData) => api.put(`/pipelines/${name}`, data).then(r => r.data),
  delete: (name: string) => api.delete(`/pipelines/${name}`).then(r => r.data)
}
