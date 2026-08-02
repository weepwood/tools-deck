export const TOOL_CATEGORIES = ['file', 'image', 'data', 'network', 'developer']
export const RUNTIME_TYPES = ['python', 'node', 'shell', 'powershell', 'executable', 'http', 'builtin', 'custom']
export const PARAMETER_TYPES = ['text', 'number', 'boolean', 'range', 'textarea', 'select', 'directory', 'files']

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeParameter(parameter, index) {
  const key = String(parameter.key ?? '').trim()
  const type = String(parameter.type ?? 'text').trim()

  return {
    ...parameter,
    key,
    label: String(parameter.label ?? (key || `参数 ${index + 1}`)).trim(),
    type,
    required: Boolean(parameter.required),
  }
}

export function validateToolManifest(input, { existingIds = [] } = {}) {
  const errors = []

  if (!isPlainObject(input)) {
    return { valid: false, errors: ['工具定义必须是一个 JSON 对象。'], manifest: null }
  }

  const id = String(input.id ?? '').trim()
  const name = String(input.name ?? '').trim()
  const category = String(input.category ?? '').trim()
  const parameters = Array.isArray(input.parameters) ? input.parameters : null

  if (!id) errors.push('缺少工具 ID。')
  else if (!idPattern.test(id)) errors.push('工具 ID 只能包含小写字母、数字和连字符。')
  else if (existingIds.includes(id)) errors.push(`工具 ID「${id}」已存在。`)

  if (!name) errors.push('缺少工具名称。')
  if (!TOOL_CATEGORIES.includes(category)) errors.push(`工具分类必须是：${TOOL_CATEGORIES.join('、')}。`)
  if (!parameters) errors.push('parameters 必须是数组。')

  const normalizedParameters = (parameters ?? []).map(normalizeParameter)
  const parameterKeys = new Set()

  normalizedParameters.forEach((parameter, index) => {
    const prefix = `参数 ${index + 1}`
    if (!parameter.key) errors.push(`${prefix} 缺少 key。`)
    else if (parameterKeys.has(parameter.key)) errors.push(`参数 key「${parameter.key}」重复。`)
    else parameterKeys.add(parameter.key)

    if (!PARAMETER_TYPES.includes(parameter.type)) {
      errors.push(`${prefix} 的类型「${parameter.type}」不受支持。`)
    }

    if (parameter.type === 'select' && (!Array.isArray(parameter.options) || parameter.options.length === 0)) {
      errors.push(`${prefix} 是 select 类型，必须提供非空 options。`)
    }

    if (['number', 'range'].includes(parameter.type)) {
      const min = parameter.min
      const max = parameter.max
      if (min !== undefined && typeof min !== 'number') errors.push(`${prefix} 的 min 必须是数字。`)
      if (max !== undefined && typeof max !== 'number') errors.push(`${prefix} 的 max 必须是数字。`)
      if (typeof min === 'number' && typeof max === 'number' && min > max) {
        errors.push(`${prefix} 的 min 不能大于 max。`)
      }
    }
  })

  const runtime = isPlainObject(input.runtime) ? input.runtime : {}
  const runtimeType = String(runtime.type ?? 'custom').trim()
  if (!RUNTIME_TYPES.includes(runtimeType)) {
    errors.push(`运行时类型「${runtimeType}」不受支持。`)
  }

  const manifest = {
    description: '通过 JSON 定义导入的自定义工具。',
    icon: 'box',
    accent: 'blue',
    tags: ['自定义'],
    updatedAt: new Date().toISOString().slice(0, 10),
    output: { artifacts: [] },
    ...input,
    id,
    name,
    category,
    parameters: normalizedParameters,
    runtime: {
      label: runtimeType === 'custom' ? '自定义运行时' : runtimeType,
      status: runtimeType === 'builtin' ? 'ready' : 'setup',
      ...runtime,
      type: runtimeType,
    },
  }

  return { valid: errors.length === 0, errors, manifest: errors.length ? null : manifest }
}

export function serializeToolManifest(tool) {
  const manifest = {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    category: tool.category,
    icon: tool.icon,
    accent: tool.accent,
    tags: tool.tags,
    runtime: tool.runtime,
    parameters: tool.parameters,
    output: tool.output,
  }

  return `${JSON.stringify(manifest, null, 2)}\n`
}
