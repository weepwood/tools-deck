const delay = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms))

const buildSteps = (tool, params) => [
  `正在准备 ${tool.runtime.label}`,
  `正在校验 ${Object.keys(params).length} 个参数`,
  '正在准备临时工作目录',
  `正在启动 ${tool.name}`,
  '正在处理任务数据',
  '正在整理输出结果',
]

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== 'object') return value

  return Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .reduce((result, key) => {
      result[key] = sortJson(value[key])
      return result
    }, {})
}

function createRunId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeError(error) {
  if (typeof error === 'string') return error
  if (error?.message) return error.message
  return '桌面运行时执行失败'
}

function mergeArtifacts(...groups) {
  const seen = new Set()
  return groups.flat().filter((artifact) => {
    const key = [artifact?.type, artifact?.label, artifact?.path, artifact?.content].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function runJsonFormatter({ params, onProgress, signal }) {
  const startedAt = Date.now()
  const progress = async (value, message) => {
    if (signal.aborted) throw new DOMException('任务已取消', 'AbortError')
    await delay(120)
    onProgress({ progress: value, message, level: value === 100 ? 'success' : 'info' })
  }

  await progress(20, '正在解析 JSON 内容')
  const parsed = JSON.parse(params.content)
  await progress(55, params.sortKeys ? '正在递归排序对象键名' : '正在保留原始键名顺序')
  const normalized = params.sortKeys ? sortJson(parsed) : parsed
  const indentation = params.indent === 'Tab' ? '\t' : Number(params.indent ?? 2)
  const content = JSON.stringify(normalized, null, indentation)
  await progress(100, 'JSON 格式化完成')

  return {
    duration: Date.now() - startedAt,
    summary: `格式化完成，共 ${content.length} 个字符`,
    artifacts: [{ type: 'text', label: '格式化结果', content }],
  }
}

async function runPreview({ tool, params, onProgress, signal }) {
  const steps = buildSteps(tool, params)
  const startedAt = Date.now()

  for (let index = 0; index < steps.length; index += 1) {
    if (signal.aborted) throw new DOMException('任务已取消', 'AbortError')

    await delay(300 + index * 50)
    onProgress({
      progress: Math.round(((index + 1) / steps.length) * 100),
      message: steps[index],
      level: index === steps.length - 1 ? 'success' : 'info',
    })
  }

  return {
    duration: Date.now() - startedAt,
    summary: `已完成 ${tool.name} 的预览运行`,
    artifacts: tool.output?.artifacts ?? [],
  }
}

async function runDesktop({ tool, params, onProgress, signal }) {
  const { invoke, Channel } = await import('@tauri-apps/api/core')
  const runId = createRunId()
  const eventArtifacts = []
  const builtin = tool.runtime.type === 'builtin'
  const execution = tool.execution ?? {}

  if (!builtin && !execution.entry) {
    throw new Error(`工具「${tool.name}」缺少 execution.entry 配置。`)
  }

  const onEvent = new Channel()
  onEvent.onmessage = (event) => {
    if (!event || event.runId !== runId) return

    if (event.event === 'started') {
      onProgress({ progress: 5, message: event.message, level: 'info' })
    } else if (event.event === 'output') {
      onProgress({
        progress: event.progress ?? 50,
        message: event.line,
        level: event.stream === 'stderr' ? 'warning' : 'info',
      })
    } else if (event.event === 'progress') {
      onProgress({
        progress: event.progress,
        message: event.message,
        level: event.level ?? 'info',
      })
    } else if (event.event === 'artifact') {
      eventArtifacts.push(event.artifact)
      onProgress({
        progress: event.progress ?? 90,
        message: `已生成：${event.artifact.label}`,
        level: 'success',
      })
    }
  }

  const cancelCommand = builtin ? 'cancel_builtin' : 'cancel_tool'
  const abortHandler = () => {
    invoke(cancelCommand, { runId }).catch(() => {})
  }
  signal.addEventListener('abort', abortHandler, { once: true })

  try {
    const command = builtin ? 'run_builtin_tool' : 'run_tool'
    const result = await invoke(command, {
      request: {
        runId,
        toolId: tool.id,
        toolName: tool.name,
        runtime: tool.runtime,
        execution,
        params,
      },
      onEvent,
    })

    if (signal.aborted || result.status === 'cancelled') {
      throw new DOMException('任务已取消', 'AbortError')
    }

    return {
      ...result,
      artifacts: mergeArtifacts(result.artifacts ?? [], eventArtifacts),
    }
  } catch (error) {
    if (signal.aborted || error?.name === 'AbortError') {
      throw new DOMException('任务已取消', 'AbortError')
    }
    throw new Error(normalizeError(error))
  } finally {
    signal.removeEventListener('abort', abortHandler)
  }
}

async function detectDesktopRuntimes() {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke('detect_runtimes')
}

export function createRuntime() {
  const isDesktop = Boolean(globalThis.__TAURI_INTERNALS__)

  return {
    mode: isDesktop ? 'desktop' : 'preview',
    async run(context) {
      if (!isDesktop) {
        if (context.tool.runtime.type === 'builtin' && context.tool.id === 'json-formatter') {
          return runJsonFormatter(context)
        }
        return runPreview(context)
      }

      return runDesktop(context)
    },
    async detectRuntimes() {
      return isDesktop ? detectDesktopRuntimes() : []
    },
  }
}
