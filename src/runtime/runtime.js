const delay = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms))

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

export function createRuntime() {
  const isDesktop = Boolean(globalThis.__TAURI_INTERNALS__)

  return {
    mode: isDesktop ? 'desktop' : 'preview',
    async run(context) {
      if (context.tool.runtime.type === 'builtin' && context.tool.id === 'json-formatter') {
        return runJsonFormatter(context)
      }

      return runPreview(context)
    },
  }
}
