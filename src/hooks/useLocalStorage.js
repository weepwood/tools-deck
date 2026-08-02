import { useEffect, useState } from 'react'

function isToolManifestList(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => item?.id && item?.runtime && Array.isArray(item?.parameters))
}

export function mergeStoredValue(storedValue, initialValue) {
  if (!isToolManifestList(initialValue) || !Array.isArray(storedValue)) return storedValue

  const storedById = new Map(storedValue.map((item) => [item?.id, item]))
  const builtInIds = new Set(initialValue.map((item) => item.id))
  const builtIns = initialValue.map((current) => {
    const stored = storedById.get(current.id)
    if (!stored) return current

    return {
      ...stored,
      ...current,
      runtime: { ...stored.runtime, ...current.runtime },
      parameters: current.parameters,
      output: current.output,
      ...(current.execution ? { execution: current.execution } : {}),
    }
  })
  const customTools = storedValue.filter((item) => item?.id && !builtInIds.has(item.id))
  return [...builtIns, ...customTools]
}

export function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw === null) return initialValue
      return mergeStoredValue(JSON.parse(raw), initialValue)
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Ignore storage failures, such as private browsing quotas.
    }
  }, [key, value])

  return [value, setValue]
}
