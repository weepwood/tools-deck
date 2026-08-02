function assertPath(path) {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('产物没有可用的本地路径。')
  }
  return path.trim()
}

function assertDesktop() {
  if (!globalThis.__TAURI_INTERNALS__) {
    throw new Error('Web 预览模式无法访问本地产物。')
  }
}

async function invoke(command, payload) {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke(command, payload)
}

export function canOpenArtifacts() {
  return Boolean(globalThis.__TAURI_INTERNALS__)
}

export async function openArtifactPath(path) {
  assertDesktop()
  return invoke('open_artifact_path', { path: assertPath(path) })
}

export async function revealArtifactPath(path) {
  assertDesktop()
  return invoke('reveal_artifact_path', { path: assertPath(path) })
}

export async function readArtifactText(path) {
  assertDesktop()
  return invoke('read_artifact_text', { path: assertPath(path) })
}
