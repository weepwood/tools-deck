export const TOOL_CATEGORIES = ['file', 'image', 'data', 'network', 'developer']
export const RUNTIME_TYPES = ['python', 'node', 'shell', 'powershell', 'executable', 'http', 'builtin', 'custom']
export const PARAMETER_TYPES = ['text', 'number', 'boolean', 'range', 'textarea', 'select', 'directory', 'files']
export const PROCESS_RUNTIME_TYPES = ['python', 'node', 'shell', 'powershell', 'executable']

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const envKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeParameter(parameter, index) {
  const source = isPlainObject(parameter) ? parameter : {}
  const key = String(source.key ?? '').trim()
  const type = String(source.type ?? 'text').trim()
  const normalized = {
    ...source,
    key,
    label: String(source.label ?? (key || `参数 ${index + 1}`)).trim(),
    type,
    required: Boolean(source.required),
  }

  if (type === 'select' && Array.isArray(source.options)) {
    normalized.options = source.options.map((option) => String(option))
  }

  return normalized
}

function normalizeExecution(value) {
  if (!isPlainObject(value)) return null
  return {
    ...value,
    entry: String(value.entry ?? '').trim(),
    args: Array.isArray(value.args) ? value.args.map((arg) => String(arg)) : [],
    cwd: value.cwd == null ? undefined : String(value.cwd),
    env: isPlainObject(value.env)
      ? Object.fromEntries(Object.entries(value.env).map(([key, item]) => [key, String(item)]))
      : {},
    timeoutSeconds: value.timeoutSeconds == null ? 3600 : Number(value.timeoutSeconds),
    argumentStringParam: value.argumentStringParam == null ? undefined : String(value.argumentStringParam),
    allowNonZeroExit: Boolean(value.allowNonZeroExit),
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
    if (!isPlainObject(parameters[index])) errors.push(`${prefix} 必须是对象。`)
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

  const execution = normalizeExecution(input.execution)
  if (PROCESS_RUNTIME_TYPES.includes(runtimeType)) {
    if (!execution?.entry) errors.push(`${runtimeType} 工具必须配置 execution.entry。`)
    if (input.execution?.args !== undefined && !Array.isArray(input.execution.args)) {
      errors.push('execution.args 必须是字符串数组。')
    }
    if (execution && (!Number.isFinite(execution.timeoutSeconds) || execution.timeoutSeconds < 1 || execution.timeoutSeconds > 86400)) {
      errors.push('execution.timeoutSeconds 必须是 1 到 86400 之间的数字。')
    }
    for (const key of Object.keys(execution?.env ?? {})) {
      if (!envKeyPattern.test(key)) errors.push(`环境变量名称不合法：${key}`)
    }
    if (execution?.argumentStringParam && !parameterKeys.has(execution.argumentStringParam)) {
      errors.push(`execution.argumentStringParam 引用了不存在的参数：${execution.argumentStringParam}`)
    }
  }

  const tags = Array.isArray(input.tags)
    ? input.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : ['自定义']

  const manifest = {
    ...input,
    id,
    name,
    description: String(input.description ?? '通过 JSON 定义导入的自定义工具。').trim(),
    category,
    icon: String(input.icon ?? 'box').trim() || 'box',
    accent: String(input.accent ?? 'blue').trim() || 'blue',
    tags,
    updatedAt: String(input.updatedAt ?? new Date().toISOString().slice(0, 10)),
    output: isPlainObject(input.output) ? input.output : { artifacts: [] },
    parameters: normalizedParameters,
    runtime: {
      ...runtime,
      type: runtimeType,
      label: String(runtime.label ?? (runtimeType === 'custom' ? '自定义运行时' : runtimeType)),
      status: String(runtime.status ?? (runtimeType === 'builtin' || execution?.entry ? 'ready' : 'setup')),
    },
    ...(execution ? { execution } : {}),
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
    execution: tool.execution,
    parameters: tool.parameters,
    output: tool.output,
  }

  return `${JSON.stringify(manifest, null, 2)}\n`
}
