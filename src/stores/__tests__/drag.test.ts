import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDragStore } from '../drag'
import type { PipelineModule } from '@/types'

function makeModule(): PipelineModule {
  return {
    type: 'wildcard',
    source: 'location',
    capture_as: '$location',
  }
}

describe('useDragStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('startDrag sets all state fields', () => {
    const store = useDragStore()
    const module = makeModule()
    const removeFromSource = vi.fn()

    store.startDrag(42, 3, module, removeFromSource)

    expect(store.sourceNodeId).toBe(42)
    expect(store.sourceIndex).toBe(3)
    expect(store.module).toEqual(module)
    expect(store.module).not.toBe(module)
    expect(store.removeFromSource).toBe(removeFromSource)
  })

  it('completeDrop calls removeFromSource', () => {
    const store = useDragStore()
    const removeFromSource = vi.fn()

    store.startDrag(7, 1, makeModule(), removeFromSource)
    store.completeDrop()

    expect(removeFromSource).toHaveBeenCalledTimes(1)
  })

  it('completeDrop clears state after callback', () => {
    const store = useDragStore()
    const removeFromSource = vi.fn()

    store.startDrag(7, 1, makeModule(), removeFromSource)
    store.completeDrop()

    expect(store.sourceNodeId).toBeNull()
    expect(store.sourceIndex).toBeNull()
    expect(store.module).toBeNull()
    expect(store.removeFromSource).toBeNull()
    expect(store.isDragging).toBe(false)
  })

  it('cancelDrag clears state without calling callback', () => {
    const store = useDragStore()
    const removeFromSource = vi.fn()

    store.startDrag(7, 1, makeModule(), removeFromSource)
    store.cancelDrag()

    expect(removeFromSource).not.toHaveBeenCalled()
    expect(store.sourceNodeId).toBeNull()
    expect(store.sourceIndex).toBeNull()
    expect(store.module).toBeNull()
    expect(store.removeFromSource).toBeNull()
  })

  it('isDragging tracks drag state', () => {
    const store = useDragStore()

    expect(store.isDragging).toBe(false)

    store.startDrag(7, 1, makeModule(), vi.fn())

    expect(store.isDragging).toBe(true)

    store.cancelDrag()

    expect(store.isDragging).toBe(false)
  })

  it('completeDrop is a no-op when not dragging', () => {
    const store = useDragStore()
    const removeFromSource = vi.fn()

    store.completeDrop()

    expect(removeFromSource).not.toHaveBeenCalled()
    expect(store.isDragging).toBe(false)
  })

  it('completeDrop still clears state when callback throws', () => {
    const store = useDragStore()
    const removeFromSource = vi.fn(() => {
      throw new Error('boom')
    })

    store.startDrag(7, 1, makeModule(), removeFromSource)
    expect(() => store.completeDrop()).not.toThrow()

    expect(removeFromSource).toHaveBeenCalledTimes(1)
    expect(store.sourceNodeId).toBeNull()
    expect(store.sourceIndex).toBeNull()
    expect(store.module).toBeNull()
    expect(store.removeFromSource).toBeNull()
  })

  it('startDrag overwrites previous drag state', () => {
    const store = useDragStore()
    const firstCallback = vi.fn()
    const secondCallback = vi.fn()

    store.startDrag(1, 0, makeModule(), firstCallback)
    store.startDrag(9, 4, { type: 'fixed', value: 'x', capture_as: '$x' }, secondCallback)

    expect(store.sourceNodeId).toBe(9)
    expect(store.sourceIndex).toBe(4)
    expect(store.module).toEqual({ type: 'fixed', value: 'x', capture_as: '$x' })
    expect(store.removeFromSource).toBe(secondCallback)
  })
})
