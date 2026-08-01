const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))

const buildSteps = (tool, params) => [
  `正在检查 ${tool.runtime.label} 运行环境`,
  `正在校验 ${Object.keys(params).length} 个参数`,
  '正在准备临时工作目录',
  `正在启动 ${tool.name}`,
  '正在处理任务数据',
  '正在整理输出结果',
]

export function createRuntime() {
  const isDesktop = Boolean(window.__TAURI_INTERNALS__)

  return {
    mode: isDesktop ? 'desktop' : 'preview',
    async run({ tool, params, onProgress, signal }) {
      const steps = buildSteps(tool, params)
      const startedAt = Date.now()

      for (let index = 0; index < steps.length; index += 1) {
        if (signal.aborted) {
          throw new DOMException('任务已取消', 'AbortError')
        }

        await delay(420 + index * 80)
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
    },
  }
}
