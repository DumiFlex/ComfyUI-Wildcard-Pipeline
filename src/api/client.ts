import axios from 'axios'
import type { WildcardOption, PipelineModule, ConstraintRule } from '../types'

const api = axios.create({ baseURL: '/wp/api' })

export interface ApiConstraintRule {
  target: string
  when_variable: string
  when_value: string
  rule_type: 'exclusion' | 'weight_bias'
  values: string[]
  multiplier?: number
}

export interface WildcardData {
  id?: string
  name: string
  version: number
  tags?: string[]
  category?: string
  options: WildcardOption[]
}

export interface ConstraintData {
  id?: string
  name: string
  tags?: string[]
  category?: string
  rules: (ConstraintRule | {
    when_value: string
    rule_type: 'exclusion' | 'weight_bias'
    values: string[]
    multiplier?: number
  })[]
}

export interface PipelineData {
  id?: string
  name: string
  version: number
  tags?: string[]
  category?: string
  modules: PipelineModule[]
}

type CreatePayload<T> = Omit<T, 'id'>

export const wildcardApi = {
  list: () => api.get<WildcardData[]>('/wildcards').then(r => r.data),
  get: (id: string) => api.get<WildcardData>(`/wildcards/${id}`).then(r => r.data),
  create: (data: CreatePayload<WildcardData>) => api.post('/wildcards', data).then(r => r.data),
  update: (id: string, data: WildcardData) => api.put(`/wildcards/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/wildcards/${id}`).then(r => r.data),
  categories: () => api.get<string[]>('/wildcards/categories').then(r => r.data),
  tags: () => api.get<string[]>('/wildcards/tags').then(r => r.data)
}

export const constraintApi = {
  list: () => api.get<ConstraintData[]>('/constraints').then(r => r.data),
  get: (id: string) => api.get<ConstraintData>(`/constraints/${id}`).then(r => r.data),
  create: (data: CreatePayload<ConstraintData>) => api.post('/constraints', data).then(r => r.data),
  update: (id: string, data: ConstraintData) => api.put(`/constraints/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/constraints/${id}`).then(r => r.data),
  categories: () => api.get<string[]>('/constraints/categories').then(r => r.data),
  tags: () => api.get<string[]>('/constraints/tags').then(r => r.data)
}

export const pipelineApi = {
  list: () => api.get<PipelineData[]>('/pipelines').then(r => r.data),
  get: (id: string) => api.get<PipelineData>(`/pipelines/${id}`).then(r => r.data),
  create: (data: CreatePayload<PipelineData>) => api.post('/pipelines', data).then(r => r.data),
  update: (id: string, data: PipelineData) => api.put(`/pipelines/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/pipelines/${id}`).then(r => r.data),
  categories: () => api.get<string[]>('/pipelines/categories').then(r => r.data),
  tags: () => api.get<string[]>('/pipelines/tags').then(r => r.data)
}

export interface PreviewRequest {
  modules: PipelineModule[]
  seed: number
}

export interface PreviewResponse {
  variables: Record<string, string>
}

export const previewApi = {
  run: (data: PreviewRequest) => api.post<PreviewResponse>('/preview', data).then(r => r.data),
}
