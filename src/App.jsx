import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './components/Icon.jsx'
import { categories, initialTools } from './data/tools.js'
import { validateToolManifest, serializeToolManifest } from './domain/manifest.js'
import { useLocalStorage } from './hooks/useLocalStorage.js'
import { createRuntime } from './runtime/runtime.js'

const runtime = createRuntime()

function getDefaultParams(tool) {
  return Object.fromEntries(
    tool.parameters.map((item) => [item.key, item.default ?? (item.type === 'boolean' ? false : '')]),
  )
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value))
}

function formatTime(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function durationText(ms = 0) {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} 秒`
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function downloadText(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type: `${type};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function ToolIcon({ tool, size = 22 }) {
  return (
    <span className={`tool-icon tool-icon--${tool.accent}`}>
      <Icon name={tool.icon} size={size} />
    </span>
  )
}

function EmptyState({ icon = 'search', title, description }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon"><Icon name={icon} size={26} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  )
}

function App() {
  const [tools, setTools] = useLocalStorage('tools-deck:tools', initialTools)
  const [favorites, setFavorites] = useLocalStorage('tools-deck:favorites', ['image-compressor', 'git-repo-audit'])
  const [history, setHistory] = useLocalStorage('tools-deck:history', [])
  const [presets, setPresets] = useLocalStorage('tools-deck:presets', {})
  const [queue, setQueue] = useLocalStorage('tools-deck:queue', [])
  const [theme, setTheme] = useLocalStorage('tools-deck:theme', 'light')
  const [activeView, setActiveView] = useState('all')
  const [selectedId, setSelectedId] = useState(initialTools[0].id)
  const [search, setSearch] = useState('')
  const [params, setParams] = useState(() => getDefaultParams(initialTools[0]))
  const [runState, setRunState] = useState(null)
  const [logs, setLogs] = useState([])
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importErrors, setImportErrors] = useState([])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [queueRunning, setQueueRunning] = useState(false)
  const abortRef = useRef(null)
  const restoreRef = useRef(null)
  const searchRef = useRef(null)

  const selectedTool = tools.find((tool) => tool.id === selectedId) ?? tools[0]
  const selectedPresets = presets[selectedTool?.id] ?? []

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    if (!selectedTool) return
    const restore = restoreRef.current
    if (restore?.toolId === selectedTool.id) {
      setParams(cloneValue(restore.params))
      restoreRef.current = null
    } else {
      setParams(getDefaultParams(selectedTool))
    }
    setLogs([])
    setRunState(null)
  }, [selectedTool?.id])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 2400)
    return () => window.clearTimeout(timer)
  }, [toast])

  const filteredTools = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return tools.filter((tool) => {
      const viewMatch =
        activeView === 'all' ||
        activeView === 'recent' ||
        (activeView === 'favorites' && favorites.includes(tool.id)) ||
        tool.category === activeView
      const searchMatch =
        !keyword ||
        [tool.name, tool.description, tool.runtime.label, ...tool.tags]
          .join(' ')
          .toLowerCase()
          .includes(keyword)
      return viewMatch && searchMatch
    })
  }, [activeView, favorites, search, tools])

  const recentTools = useMemo(() => {
    const order = new Map(history.map((item, index) => [item.toolId, index]))
    return [...filteredTools]
      .filter((tool) => order.has(tool.id))
      .sort((left, right) => order.get(left.id) - order.get(right.id))
  }, [filteredTools, history])

  const visibleTools = activeView === 'recent' ? recentTools : filteredTools
  const pendingQueueCount = queue.filter((item) => item.status === 'pending').length

  const notify = (message) => setToast(message)

  const toggleFavorite = (toolId) => {
    setFavorites((items) =>
      items.includes(toolId) ? items.filter((id) => id !== toolId) : [...items, toolId],
    )
  }

  const updateParam = (key, value) => {
    setParams((current) => ({ ...current, [key]: value }))
  }

  const validateParams = (tool, values, showToast = true) => {
    const missing = tool.parameters.find(
      (item) => item.required && String(values[item.key] ?? '').trim() === '',
    )
    if (missing) {
      if (showToast) notify(`请先填写：${missing.label}`)
      return false
    }
    return true
  }

  const appendHistory = (record) => {
    setHistory((items) => [record, ...items].slice(0, 100))
  }

  const runTool = async () => {
    if (!selectedTool || !validateParams(selectedTool, params) || runState?.status === 'running') return

    const controller = new AbortController()
    abortRef.current = controller
    const startedAt = new Date().toISOString()
    setLogs([{ time: Date.now(), message: `准备运行「${selectedTool.name}」`, level: 'info' }])
    setRunState({ status: 'running', progress: 2, startedAt, artifacts: [] })

    try {
      const result = await runtime.run({
        tool: selectedTool,
        params: cloneValue(params),
        signal: controller.signal,
        onProgress: ({ progress, message, level }) => {
          setRunState((current) => ({ ...current, progress }))
          setLogs((items) => [...items, { time: Date.now(), message, level }])
        },
      })

      appendHistory({
        id: createId(),
        toolId: selectedTool.id,
        toolName: selectedTool.name,
        status: 'success',
        startedAt,
        duration: result.duration,
        summary: result.summary,
        params: cloneValue(params),
        artifacts: result.artifacts,
      })
      setRunState({ status: 'success', progress: 100, startedAt, result, artifacts: result.artifacts })
      notify('任务运行完成')
    } catch (error) {
      const cancelled = error?.name === 'AbortError'
      const duration = Date.now() - new Date(startedAt).getTime()
      const summary = cancelled ? '用户取消了任务' : error.message
      appendHistory({
        id: createId(),
        toolId: selectedTool.id,
        toolName: selectedTool.name,
        status: cancelled ? 'cancelled' : 'failed',
        startedAt,
        duration,
        summary,
        params: cloneValue(params),
        artifacts: [],
      })
      setRunState({ status: cancelled ? 'cancelled' : 'failed', progress: 0, startedAt, artifacts: [] })
      setLogs((items) => [...items, { time: Date.now(), message: summary, level: cancelled ? 'warning' : 'error' }])
    }
  }

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && activeView !== 'history' && activeView !== 'queue') {
        event.preventDefault()
        runTool()
      }
      if (event.key === 'Escape') {
        setShowImport(false)
        setSidebarOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeView, params, runState?.status, selectedTool?.id])

  const cancelRun = () => abortRef.current?.abort()

  const selectTool = (tool) => {
    setSelectedId(tool.id)
    setSidebarOpen(false)
  }

  const importTool = () => {
    setImportErrors([])
    try {
      const parsed = JSON.parse(importText)
      const result = validateToolManifest(parsed, { existingIds: tools.map((tool) => tool.id) })
      if (!result.valid) {
        setImportErrors(result.errors)
        return
      }
      setTools((items) => [...items, result.manifest])
      setSelectedId(result.manifest.id)
      setActiveView('all')
      setShowImport(false)
      setImportText('')
      notify('工具已通过校验并导入')
    } catch (error) {
      setImportErrors([`JSON 解析失败：${error.message}`])
    }
  }

  const exportTool = () => {
    if (!selectedTool) return
    downloadText(`${selectedTool.id}.tool.json`, serializeToolManifest(selectedTool))
    notify('工具定义已导出')
  }

  const savePreset = (name) => {
    if (!selectedTool) return
    const finalName = name.trim() || `预设 ${selectedPresets.length + 1}`
    const preset = { id: createId(), name: finalName, params: cloneValue(params), createdAt: new Date().toISOString() }
    setPresets((current) => ({ ...current, [selectedTool.id]: [preset, ...(current[selectedTool.id] ?? [])].slice(0, 12) }))
    notify(`已保存参数预设「${finalName}」`)
  }

  const loadPreset = (preset) => {
    setParams(cloneValue(preset.params))
    notify(`已载入「${preset.name}」`)
  }

  const deletePreset = (presetId) => {
    setPresets((current) => ({
      ...current,
      [selectedTool.id]: (current[selectedTool.id] ?? []).filter((item) => item.id !== presetId),
    }))
  }

  const addToQueue = () => {
    if (!selectedTool || !validateParams(selectedTool, params)) return
    setQueue((items) => [...items, {
      id: createId(),
      toolId: selectedTool.id,
      toolName: selectedTool.name,
      params: cloneValue(params),
      status: 'pending',
      progress: 0,
      addedAt: new Date().toISOString(),
      summary: '等待运行',
    }])
    notify('已加入任务队列')
  }

  const updateQueueItem = (id, patch) => {
    setQueue((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  const runQueue = async () => {
    if (queueRunning) return
    const tasks = queue.filter((item) => item.status === 'pending')
    if (!tasks.length) {
      notify('队列中没有待运行任务')
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setQueueRunning(true)

    for (const task of tasks) {
      if (controller.signal.aborted) break
      const tool = tools.find((item) => item.id === task.toolId)
      if (!tool) {
        updateQueueItem(task.id, { status: 'failed', summary: '工具已不存在' })
        continue
      }

      const startedAt = new Date().toISOString()
      updateQueueItem(task.id, { status: 'running', progress: 2, summary: '正在准备运行' })
      try {
        const result = await runtime.run({
          tool,
          params: cloneValue(task.params),
          signal: controller.signal,
          onProgress: ({ progress, message }) => updateQueueItem(task.id, { progress, summary: message }),
        })
        updateQueueItem(task.id, {
          status: 'success',
          progress: 100,
          duration: result.duration,
          summary: result.summary,
          artifacts: result.artifacts,
        })
        appendHistory({
          id: createId(),
          toolId: tool.id,
          toolName: tool.name,
          status: 'success',
          startedAt,
          duration: result.duration,
          summary: result.summary,
          params: cloneValue(task.params),
          artifacts: result.artifacts,
        })
      } catch (error) {
        const cancelled = error?.name === 'AbortError'
        const duration = Date.now() - new Date(startedAt).getTime()
        updateQueueItem(task.id, {
          status: cancelled ? 'cancelled' : 'failed',
          duration,
          summary: cancelled ? '队列已停止' : error.message,
        })
        appendHistory({
          id: createId(),
          toolId: tool.id,
          toolName: tool.name,
          status: cancelled ? 'cancelled' : 'failed',
          startedAt,
          duration,
          summary: cancelled ? '队列已停止' : error.message,
          params: cloneValue(task.params),
          artifacts: [],
        })
        if (cancelled) break
      }
    }

    setQueueRunning(false)
    notify(controller.signal.aborted ? '任务队列已停止' : '任务队列运行结束')
  }

  const openHistoryRecord = (record) => {
    const tool = tools.find((item) => item.id === record.toolId)
    if (!tool) return
    if (selectedTool?.id === tool.id) {
      setParams(cloneValue(record.params ?? getDefaultParams(tool)))
    } else {
      restoreRef.current = { toolId: tool.id, params: record.params ?? getDefaultParams(tool) }
      setSelectedId(tool.id)
    }
    setActiveView('all')
  }

  const viewTitle =
    activeView === 'favorites'
      ? '收藏工具'
      : activeView === 'recent'
        ? '最近使用'
        : categories.find((item) => item.id === activeView)?.name ?? '全部工具'

  return (
    <div className="app-shell">
      <div className={`mobile-scrim ${sidebarOpen ? 'is-visible' : ''}`} onClick={() => setSidebarOpen(false)} />

      <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}>
        <div className="brand">
          <span className="brand__mark"><Icon name="spark" size={20} /></span>
          <div><strong>Tools Deck</strong><span>个人工具库</span></div>
          <button className="icon-button sidebar__close" onClick={() => setSidebarOpen(false)} aria-label="关闭导航"><Icon name="x" /></button>
        </div>

        <nav className="nav-section" aria-label="主导航">
          <p className="nav-label">工作台</p>
          <NavItem icon="grid" label="全部工具" count={tools.length} active={activeView === 'all'} onClick={() => setActiveView('all')} />
          <NavItem icon="star" label="我的收藏" count={favorites.length} active={activeView === 'favorites'} onClick={() => setActiveView('favorites')} />
          <NavItem icon="clock" label="最近使用" active={activeView === 'recent'} onClick={() => setActiveView('recent')} />
          <NavItem icon="queue" label="任务队列" count={pendingQueueCount || queue.length} active={activeView === 'queue'} onClick={() => setActiveView('queue')} />
          <NavItem icon="history" label="运行记录" count={history.length} active={activeView === 'history'} onClick={() => setActiveView('history')} />
        </nav>

        <nav className="nav-section" aria-label="工具分类">
          <p className="nav-label">工具分类</p>
          {categories.slice(1).map((category) => (
            <NavItem
              key={category.id}
              icon={category.icon}
              label={category.name}
              count={tools.filter((tool) => tool.category === category.id).length}
              active={activeView === category.id}
              onClick={() => setActiveView(category.id)}
            />
          ))}
        </nav>

        <div className="sidebar-card">
          <span className="sidebar-card__icon"><Icon name="box" /></span>
          <div><strong>扩展你的工具库</strong><p>导入并校验标准工具定义。</p></div>
          <button onClick={() => setShowImport(true)}>导入工具</button>
        </div>

        <div className="sidebar-footer">
          <button className="nav-item" onClick={() => notify('设置中心将在桌面运行时阶段开放')}><Icon name="settings" /><span>设置</span></button>
          <span className={`runtime-badge runtime-badge--${runtime.mode}`}><i />{runtime.mode === 'desktop' ? '桌面运行时' : 'Web 预览模式'}</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="打开导航"><Icon name="menu" /></button>
          <label className="search-box">
            <Icon name="search" />
            <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索工具、标签或运行环境" />
            <kbd>⌘ K</kbd>
          </label>
          <div className="topbar__actions">
            <button className="icon-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label="切换主题"><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button>
            <button className="primary-button primary-button--compact" onClick={() => setShowImport(true)}><Icon name="plus" />新建工具</button>
          </div>
        </header>

        {activeView === 'history' ? (
          <HistoryView history={history} tools={tools} onOpen={openHistoryRecord} onClear={() => setHistory([])} />
        ) : activeView === 'queue' ? (
          <QueueView
            queue={queue}
            tools={tools}
            running={queueRunning}
            onRun={runQueue}
            onStop={cancelRun}
            onRemove={(id) => setQueue((items) => items.filter((item) => item.id !== id))}
            onRetry={(id) => updateQueueItem(id, { status: 'pending', progress: 0, summary: '等待运行' })}
            onClear={() => setQueue((items) => items.filter((item) => ['pending', 'running'].includes(item.status)))}
          />
        ) : (
          <div className="content-grid">
            <section className="library-panel">
              <div className="section-heading">
                <div><p>TOOLS LIBRARY</p><h1>{viewTitle}</h1><span>{visibleTools.length} 个可用工具</span></div>
                <button className="secondary-button" onClick={() => setShowImport(true)}><Icon name="upload" />导入</button>
              </div>

              <div className="insight-row">
                <article><span className="insight-icon insight-icon--blue"><Icon name="grid" /></span><div><strong>{tools.length}</strong><p>工具总数</p></div></article>
                <article><span className="insight-icon insight-icon--green"><Icon name="check" /></span><div><strong>{tools.filter((tool) => tool.runtime.status === 'ready').length}</strong><p>环境就绪</p></div></article>
                <article><span className="insight-icon insight-icon--orange"><Icon name="queue" /></span><div><strong>{pendingQueueCount}</strong><p>等待运行</p></div></article>
              </div>

              {visibleTools.length ? (
                <div className="tool-list">
                  {visibleTools.map((tool) => (
                    <article key={tool.id} className={`tool-card ${selectedTool?.id === tool.id ? 'is-selected' : ''}`} onClick={() => selectTool(tool)}>
                      <ToolIcon tool={tool} />
                      <div className="tool-card__body">
                        <div className="tool-card__title"><h2>{tool.name}</h2><span>{tool.runtime.label}</span></div>
                        <p>{tool.description}</p>
                        <div className="tag-row">{tool.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>
                      </div>
                      <button className={`favorite-button ${favorites.includes(tool.id) ? 'is-active' : ''}`} onClick={(event) => { event.stopPropagation(); toggleFavorite(tool.id) }} aria-label="收藏工具"><Icon name="star" /></button>
                      <Icon name="chevron" className="tool-card__chevron" />
                    </article>
                  ))}
                </div>
              ) : <EmptyState title="没有找到匹配工具" description="尝试更换分类或搜索关键词。" />}
            </section>

            {selectedTool ? (
              <ToolDetail
                tool={selectedTool}
                params={params}
                onParamChange={updateParam}
                favorite={favorites.includes(selectedTool.id)}
                onFavorite={() => toggleFavorite(selectedTool.id)}
                runState={runState}
                logs={logs}
                onRun={runTool}
                onCancel={cancelRun}
                onQueue={addToQueue}
                onExport={exportTool}
                presets={selectedPresets}
                onSavePreset={savePreset}
                onLoadPreset={loadPreset}
                onDeletePreset={deletePreset}
                onCopy={(content) => navigator.clipboard?.writeText(content).then(() => notify('结果已复制'))}
                runtimeMode={runtime.mode}
              />
            ) : null}
          </div>
        )}
      </main>

      {showImport ? (
        <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowImport(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
            <div className="modal__header">
              <div><p>TOOL MANIFEST</p><h2 id="import-title">导入工具定义</h2></div>
              <button className="icon-button" onClick={() => setShowImport(false)}><Icon name="x" /></button>
            </div>
            <p className="modal__description">粘贴 JSON 工具定义。系统会校验工具 ID、分类、运行时和参数结构后再导入。</p>
            <textarea className="manifest-editor" value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={'{\n  "id": "my-tool",\n  "name": "我的工具",\n  "category": "developer",\n  "parameters": []\n}'} spellCheck="false" />
            {importErrors.length ? <div className="error-message error-message--stack"><Icon name="alert" /><ul>{importErrors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
            <div className="modal__actions">
              <button className="secondary-button" onClick={() => setShowImport(false)}>取消</button>
              <button className="primary-button" onClick={importTool}><Icon name="upload" />校验并导入</button>
            </div>
          </section>
        </div>
      ) : null}

      {toast ? <div className="toast"><Icon name="check" />{toast}</div> : null}
    </div>
  )
}

function NavItem({ icon, label, count, active, onClick }) {
  return <button className={`nav-item ${active ? 'is-active' : ''}`} onClick={onClick}><Icon name={icon} /><span>{label}</span>{count !== undefined ? <em>{count}</em> : null}</button>
}

function ToolDetail({ tool, params, onParamChange, favorite, onFavorite, runState, logs, onRun, onCancel, onQueue, onExport, presets, onSavePreset, onLoadPreset, onDeletePreset, onCopy, runtimeMode }) {
  const [presetName, setPresetName] = useState('')
  const artifacts = runState?.artifacts ?? []

  const savePreset = () => {
    onSavePreset(presetName)
    setPresetName('')
  }

  return (
    <aside className="detail-panel">
      <div className="detail-hero">
        <div className="detail-hero__top">
          <ToolIcon tool={tool} size={25} />
          <div className="detail-hero__actions">
            <button className="icon-button icon-button--small" onClick={onExport} aria-label="导出工具定义"><Icon name="download" /></button>
            <button className={`favorite-button ${favorite ? 'is-active' : ''}`} onClick={onFavorite}><Icon name="star" /></button>
          </div>
        </div>
        <p className="eyebrow">{tool.category.toUpperCase()} TOOL</p>
        <h2>{tool.name}</h2>
        <p className="detail-description">{tool.description}</p>
        <div className="runtime-line"><span><i className={tool.runtime.status} />{tool.runtime.label}</span><em>更新于 {tool.updatedAt}</em></div>
        {runtimeMode === 'preview' && tool.runtime.type !== 'builtin' ? <div className="runtime-notice"><Icon name="alert" /><span>当前为 Web 预览运行；桌面版接入后才会启动本地脚本。</span></div> : null}
      </div>

      <div className="detail-section">
        <div className="detail-section__heading"><div><p>PARAMETERS</p><h3>运行参数</h3></div><button onClick={() => tool.parameters.forEach((item) => onParamChange(item.key, item.default ?? (item.type === 'boolean' ? false : '')))}>重置</button></div>
        <div className="parameter-form">{tool.parameters.map((parameter) => <ParameterField key={parameter.key} parameter={parameter} value={params[parameter.key]} onChange={(value) => onParamChange(parameter.key, value)} />)}</div>
      </div>

      <div className="preset-panel">
        <div className="preset-panel__title"><span><Icon name="save" />参数预设</span><em>{presets.length}/12</em></div>
        <div className="preset-editor"><input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="例如：微信公众号图片" /><button onClick={savePreset}>保存</button></div>
        {presets.length ? <div className="preset-list">{presets.map((preset) => <div className="preset-chip" key={preset.id}><button onClick={() => onLoadPreset(preset)}>{preset.name}</button><button onClick={() => onDeletePreset(preset.id)} aria-label="删除预设"><Icon name="x" size={12} /></button></div>)}</div> : <p className="preset-empty">保存常用参数后，可一键恢复。</p>}
      </div>

      <div className="run-box">
        {runState?.status === 'running' ? (
          <>
            <div className="progress-meta"><strong>正在运行</strong><span>{runState.progress}%</span></div>
            <div className="progress-track"><i style={{ width: `${runState.progress}%` }} /></div>
            <button className="danger-button" onClick={onCancel}><Icon name="stop" />停止任务</button>
          </>
        ) : (
          <div className="run-action-row">
            <button className="run-button" onClick={onRun}><Icon name="play" />运行工具<span>⌘ ↵</span></button>
            <button className="queue-button" onClick={onQueue} title="加入任务队列"><Icon name="queue" /></button>
          </div>
        )}
        <p><Icon name="terminal" />运行时将校验参数并记录执行日志</p>
      </div>

      {artifacts.length ? <ArtifactPanel artifacts={artifacts} onCopy={onCopy} /> : null}

      <div className="console-panel">
        <div className="console-panel__header"><span><i /><i /><i /></span><strong>执行日志</strong><em>{logs.length} 条</em></div>
        <div className="console-output">
          {logs.length ? logs.map((log, index) => <div key={`${log.time}-${index}`} className={`log-line log-line--${log.level}`}><time>{new Date(log.time).toLocaleTimeString('zh-CN', { hour12: false })}</time><span>{log.message}</span></div>) : <p className="console-placeholder">运行工具后，日志将在这里实时显示。</p>}
        </div>
      </div>
    </aside>
  )
}

function ArtifactPanel({ artifacts, onCopy }) {
  return (
    <div className="artifact-panel">
      <div className="artifact-panel__heading"><span>输出结果</span><em>{artifacts.length} 项</em></div>
      {artifacts.map((artifact, index) => (
        <article className="artifact-card" key={`${artifact.label}-${index}`}>
          <div><Icon name={artifact.type === 'text' ? 'code' : artifact.type === 'directory' ? 'box' : 'file'} /><span><strong>{artifact.label}</strong><small>{artifact.type}</small></span></div>
          {artifact.content ? <button onClick={() => onCopy(artifact.content)}><Icon name="copy" />复制</button> : null}
          {artifact.content ? <pre>{artifact.content}</pre> : null}
        </article>
      ))}
    </div>
  )
}

function ParameterField({ parameter, value, onChange }) {
  const id = `param-${parameter.key}`

  if (parameter.type === 'boolean') {
    return <label className="switch-field" htmlFor={id}><div><strong>{parameter.label}</strong><span>{parameter.description ?? '启用后将在运行时应用该选项'}</span></div><input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /><i /></label>
  }

  if (parameter.type === 'range') {
    return <label className="form-field" htmlFor={id}><span>{parameter.label}<em>{value}</em></span><input id={id} className="range-input" type="range" min={parameter.min} max={parameter.max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>
  }

  if (parameter.type === 'textarea') {
    return <label className="form-field" htmlFor={id}><span>{parameter.label}{parameter.required ? <b>*</b> : null}</span><textarea id={id} value={value ?? ''} placeholder={parameter.placeholder} onChange={(event) => onChange(event.target.value)} /></label>
  }

  if (parameter.type === 'select') {
    return <label className="form-field" htmlFor={id}><span>{parameter.label}</span><select id={id} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>{parameter.options.map((option) => <option key={option}>{option}</option>)}</select></label>
  }

  if (parameter.type === 'directory' || parameter.type === 'files') {
    return <label className="form-field" htmlFor={id}><span>{parameter.label}{parameter.required ? <b>*</b> : null}</span><div className="path-input"><Icon name={parameter.type === 'files' ? 'file' : 'box'} /><input id={id} value={value ?? ''} placeholder={parameter.placeholder ?? '输入或选择路径'} onChange={(event) => onChange(event.target.value)} /><button type="button" onClick={() => onChange(parameter.type === 'files' ? '已选择 3 个文件' : 'D:/Tools/input')}>浏览</button></div></label>
  }

  return <label className="form-field" htmlFor={id}><span>{parameter.label}{parameter.required ? <b>*</b> : null}</span><input id={id} type={parameter.type === 'number' ? 'number' : 'text'} min={parameter.min} max={parameter.max} value={value ?? ''} placeholder={parameter.placeholder} onChange={(event) => onChange(parameter.type === 'number' ? (event.target.value === '' ? '' : Number(event.target.value)) : event.target.value)} /></label>
}

function QueueView({ queue, tools, running, onRun, onStop, onRemove, onRetry, onClear }) {
  const counts = queue.reduce((result, item) => ({ ...result, [item.status]: (result[item.status] ?? 0) + 1 }), {})
  return (
    <section className="queue-page">
      <div className="section-heading history-heading">
        <div><p>TASK QUEUE</p><h1>任务队列</h1><span>顺序执行多个工具任务</span></div>
        <div className="page-actions">
          {queue.some((item) => ['success', 'failed', 'cancelled'].includes(item.status)) ? <button className="secondary-button" onClick={onClear}>清理已结束</button> : null}
          {running ? <button className="danger-button danger-button--auto" onClick={onStop}><Icon name="stop" />停止队列</button> : <button className="primary-button" onClick={onRun}><Icon name="play" />运行队列</button>}
        </div>
      </div>
      <div className="queue-summary">
        <article><strong>{queue.length}</strong><span>全部任务</span></article>
        <article><strong>{counts.pending ?? 0}</strong><span>等待运行</span></article>
        <article><strong>{counts.success ?? 0}</strong><span>运行成功</span></article>
        <article><strong>{counts.failed ?? 0}</strong><span>运行失败</span></article>
      </div>
      {queue.length ? <div className="queue-list">{queue.map((item, index) => {
        const tool = tools.find((entry) => entry.id === item.toolId)
        return <article className={`queue-card queue-card--${item.status}`} key={item.id}>
          <span className="queue-index">{String(index + 1).padStart(2, '0')}</span>
          {tool ? <ToolIcon tool={tool} size={18} /> : <span className="queue-missing"><Icon name="alert" /></span>}
          <div className="queue-card__body"><div><strong>{item.toolName}</strong><span className={`status-pill status-pill--${item.status}`}><i />{statusText(item.status)}</span></div><p>{item.summary}</p>{item.status === 'running' ? <div className="progress-track"><i style={{ width: `${item.progress}%` }} /></div> : null}</div>
          <div className="queue-card__actions">{['failed', 'cancelled'].includes(item.status) ? <button onClick={() => onRetry(item.id)} title="重试"><Icon name="retry" /></button> : null}<button onClick={() => onRemove(item.id)} disabled={item.status === 'running'} title="移除"><Icon name="trash" /></button></div>
        </article>
      })}</div> : <EmptyState icon="queue" title="任务队列为空" description="在工具详情中点击队列按钮，将当前参数加入队列。" />}
    </section>
  )
}

function statusText(status) {
  return { pending: '等待中', running: '运行中', success: '成功', failed: '失败', cancelled: '已取消' }[status] ?? status
}

function HistoryView({ history, tools, onOpen, onClear }) {
  return (
    <section className="history-page">
      <div className="section-heading history-heading"><div><p>EXECUTION HISTORY</p><h1>运行记录</h1><span>保留最近 100 次执行结果与参数</span></div>{history.length ? <button className="secondary-button" onClick={onClear}>清空记录</button> : null}</div>
      {history.length ? <div className="history-table"><div className="history-row history-row--head"><span>工具</span><span>状态</span><span>运行时间</span><span>耗时</span><span /></div>{history.map((item) => {
        const tool = tools.find((entry) => entry.id === item.toolId)
        return <div className="history-row" key={item.id}><div className="history-tool">{tool ? <ToolIcon tool={tool} size={18} /> : null}<div><strong>{item.toolName}</strong><small>{item.summary}</small></div></div><span className={`status-pill status-pill--${item.status}`}><i />{statusText(item.status)}</span><time>{formatTime(item.startedAt)}</time><span>{durationText(item.duration)}</span><button className="link-button" onClick={() => onOpen(item)}>载入参数</button></div>
      })}</div> : <EmptyState icon="history" title="还没有运行记录" description="完成一次工具运行后，结果会出现在这里。" />}
    </section>
  )
}

export default App
