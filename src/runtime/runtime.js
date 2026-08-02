const delay = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms))

const desktopExecutionDefaults = {
  'image-compressor': {
    entry: 'tools/builtin/image-compressor.py',
    timeoutSeconds: 3600,
  },
  'batch-renamer': {
    entry: 'tools/builtin/batch-renamer.mjs',
    timeoutSeconds: 1800,
  },
  'excel-merger': {
    entry: 'tools/builtin/excel-merger.py',
    timeoutSeconds: 3600,
  },
  'http-batch-check': {
    entry: 'tools/builtin/http-batch-check.py',
    timeoutSeconds: 1800,
  },
  'git-repo-audit': {
    entry: 'tools/builtin/git-repo-audit.ps1',
    timeoutSeconds: 900,
  },
}

const buildSteps = (tool, params) => [
  `正在检查 ${tool.runtime.label} 运行环境`,
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

function normalizeDesktopRuntime(tool) {
  if (tool.id === 'git-repo-audit' && tool.runtime.type === 'shell') {
    return { ...tool.runtime, type: 'powershell', label: 'PowerShell' }
  }
  return tool.runtime
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
  const artifacts = []
  const execution = tool.execution ?? desktopExecutionDefaults[tool.id]
  const runtime = normalizeDesktopRuntime(tool)

  if (!execution) {
    throw new Error(`工具「${tool.name}」缺少 execution 配置。`)
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
      artifacts.push(event.artifact)
      onProgress({
        progress: event.progress ?? 90,
        message: `已生成：${event.artifact.label}`,
        level: 'success',
      })
    }
  }

  const abortHandler = () => {
    invoke('cancel_tool', { runId }).catch(() => {})
  }
  signal.addEventListener('abort', abortHandler, { once: true })

  try {
    const result = await invoke('run_tool', {
      request: {
        runId,
        toolId: tool.id,
        toolName: tool.name,
        runtime,
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
      artifacts: [...(result.artifacts ?? []), ...artifacts],
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
      if (context.tool.runtime.type === 'builtin' && context.tool.id === 'json-formatter') {
        return runJsonFormatter(context)
      }

      return isDesktop ? runDesktop(context) : runPreview(context)
    },
    async detectRuntimes() {
      return isDesktop ? detectDesktopRuntimes() : []
    },
  }
}
