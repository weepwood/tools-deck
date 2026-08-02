function assertPath(path) {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('产物没有可用的本地路径。')
  }
  return path.trim()
}

export function canOpenArtifacts() {
  return Boolean(globalThis.__TAURI_INTERNALS__)
}

export async function openArtifactPath(path) {
  const target = assertPath(path)
  if (!canOpenArtifacts()) {
    throw new Error('Web 预览模式无法打开本地文件。')
  }
  const { openPath } = await import('@tauri-apps/plugin-opener')
  await openPath(target)
}

export async function revealArtifactPath(path) {
  const target = assertPath(path)
  if (!canOpenArtifacts()) {
    throw new Error('Web 预览模式无法定位本地文件。')
  }
  const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
  await revealItemInDir(target)
}
