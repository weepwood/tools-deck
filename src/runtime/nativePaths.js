function setReactInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, 'value')?.set
  if (setter) setter.call(input, value)
  else input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

export function getPathSelectionType(container) {
  return container?.querySelector('svg[data-icon]')?.dataset.icon === 'file' ? 'files' : 'directory'
}

export function installNativePathPicker() {
  if (!globalThis.__TAURI_INTERNALS__) return () => {}

  const onClick = async (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('.path-input button')
    if (!button) return

    const container = button.closest('.path-input')
    const input = container?.querySelector('input')
    const label = button.closest('label')?.querySelector(':scope > span')?.textContent ?? '路径'
    if (!(input instanceof HTMLInputElement)) return

    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selectionType = getPathSelectionType(container)
      const selected = await open(
        selectionType === 'directory'
          ? { directory: true, multiple: false, title: `选择${label}` }
          : { directory: false, multiple: true, title: `选择${label}` },
      )
      if (selected == null) return
      const value = Array.isArray(selected) ? selected.join('\n') : selected
      setReactInputValue(input, value)
    } catch (error) {
      console.error('打开原生路径选择器失败', error)
    }
  }

  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}
