import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './components/Icon.jsx'
import { categories, initialTools } from './data/tools.js'
import { validateToolManifest, serializeToolManifest } from './domain/manifest.js'
import { useLocalStorage } from './hooks/useLocalStorage.js'
import { createRuntime } from './runtime/runtime.js'

const runtime = createRuntime()

const PAGE_META = {
  home: { title: '首页', subtitle: '继续工作并快速启动常用工具' },
  library: { title: '工具库', subtitle: '浏览、搜索和管理全部工具' },
  tasks: { title: '任务', subtitle: '管理等待、运行中和已完成的任务' },
  history: { title: '历史', subtitle: '查看运行记录并恢复参数' },
  settings: { title: '设置', subtitle: '调整外观和桌面运行选项' },
}

function getDefaultParams(tool) {
  return Object.fromEntries(
    (tool?.parameters ?? []).map((item) => [
      item.key,
      item.default ?? (item.type === 'boolean' ? false : ''),
    ]),
  )
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value))
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function formatTime(value) {
  if (!value) return '—'
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

function downloadText(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type: `${type};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

async function copyText(content) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = content
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function ToolIcon({ tool, size = 20 }) {
  return (
    <span className={`tool-icon tool-icon--${tool.accent}`}>
      <Icon name={tool.icon} size={size} />
    </span>
  )
}

function StatusPill({ status }) {
  const labels = {
    pending: '等待中',
    running: '运行中',
    success: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }
  return <span className={`status-pill status-pill--${status}`}><i />{labels[status] ?? status}</span>
}

function EmptyState({ icon = 'search', title, description, action }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon"><Icon name={icon} size={25} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
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
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage('tools-deck:sidebar-collapsed', false)

  const [page, setPage] = useState('home')
  const [selectedId, setSelectedId] = useState(initialTools[0].id)
  const [libraryCategory, setLibraryCategory] = useState('all')
  const [librarySearch, setLibrarySearch] = useState('')
  const [libraryMode, setLibraryMode] = useLocalStorage('tools-deck:library-mode', 'grid')
  const [params, setParams] = useState(() => getDefaultParams(initialTools[0]))
  const [runState, setRunState] = useState(null)
  const [logs, setLogs] = useState([])
  const [queueRunning, setQueueRunning] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importErrors, setImportErrors] = useState([])
  const [toast, setToast] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const abortRef = useRef(null)
  const restoreRef = useRef(null)

  const selectedTool = tools.find((tool) => tool.id === selectedId) ?? tools[0]
  const selectedPresets = presets[selectedTool?.id] ?? []
  const pendingCount = queue.filter((item) => item.status === 'pending').length
  const runningCount = queue.filter((item) => item.status === 'running').length + (runState?.status === 'running' ? 1 : 0)
  const activityCount = pendingCount + runningCount

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
    if (runState?.status !== 'running') {
      setLogs([])
      setRunState(null)
    }
  }, [selectedTool?.id])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 2400)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen((open) => !open)
      }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key === 'Enter' && page === 'workspace') {
        event.preventDefault()
        runTool()
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'Enter' && page === 'workspace') {
        event.preventDefault()
        addToQueue()
      }
      if (event.key === 'Escape') {
        setCommandOpen(false)
        setActivityOpen(false)
        setShowImport(false)
        setMobileNavOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const notify = (message) => setToast(message)

  const navigate = (nextPage) => {
    setPage(nextPage)
    setMobileNavOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openTool = (tool, nextParams = null) => {
    if (!tool) return
    if (nextParams) {
      if (selectedId === tool.id) setParams(cloneValue(nextParams))
      else restoreRef.current = { toolId: tool.id, params: nextParams }
    }
    setSelectedId(tool.id)
    setPage('workspace')
    setMobileNavOpen(false)
    setCommandOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const toggleFavorite = (toolId) => {
    setFavorites((items) => items.includes(toolId)
      ? items.filter((id) => id !== toolId)
      : [...items, toolId])
  }

  const validateParams = (tool, values, showToast = true) => {
    const missing = tool.parameters.find((item) => {
      if (!item.required) return false
      const value = values[item.key]
      return Array.isArray(value) ? value.length === 0 : String(value ?? '').trim() === ''
    })
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
    if (queueRunning) {
      notify('任务队列正在运行，请先停止队列')
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    const startedAt = new Date().toISOString()
    setLogs([{ time: Date.now(), message: `准备运行「${selectedTool.name}」`, level: 'info' }])
    setRunState({ status: 'running', progress: 2, startedAt, toolId: selectedTool.id, artifacts: [] })

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
      const record = {
        id: createId(), toolId: selectedTool.id, toolName: selectedTool.name,
        status: 'success', startedAt, duration: result.duration, summary: result.summary,
        params: cloneValue(params), artifacts: result.artifacts,
      }
      appendHistory(record)
      setRunState({ status: 'success', progress: 100, startedAt, toolId: selectedTool.id, result, artifacts: result.artifacts })
      notify('任务运行完成')
    } catch (error) {
      const cancelled = error?.name === 'AbortError'
      const duration = Date.now() - new Date(startedAt).getTime()
      const summary = cancelled ? '用户取消了任务' : error.message
      appendHistory({
        id: createId(), toolId: selectedTool.id, toolName: selectedTool.name,
        status: cancelled ? 'cancelled' : 'failed', startedAt, duration, summary,
        params: cloneValue(params), artifacts: [],
      })
      setRunState({ status: cancelled ? 'cancelled' : 'failed', progress: 0, startedAt, toolId: selectedTool.id, artifacts: [] })
      setLogs((items) => [...items, { time: Date.now(), message: summary, level: cancelled ? 'warning' : 'error' }])
    }
  }

  const cancelRun = () => abortRef.current?.abort()

  const savePreset = (name) => {
    if (!selectedTool) return
    const finalName = name.trim() || `预设 ${selectedPresets.length + 1}`
    const preset = { id: createId(), name: finalName, params: cloneValue(params), createdAt: new Date().toISOString() }
    setPresets((current) => ({
      ...current,
      [selectedTool.id]: [preset, ...(current[selectedTool.id] ?? [])].slice(0, 12),
    }))
    notify(`已保存参数预设「${finalName}」`)
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
      id: createId(), toolId: selectedTool.id, toolName: selectedTool.name,
      params: cloneValue(params), status: 'pending', progress: 0,
      addedAt: new Date().toISOString(), summary: '等待运行', artifacts: [],
    }])
    setActivityOpen(true)
    notify('已加入任务队列')
  }

  const updateQueueItem = (id, patch) => {
    setQueue((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  const runQueue = async () => {
    if (queueRunning) return
    if (runState?.status === 'running') {
      notify('当前工具正在运行，请等待完成或先停止任务')
      return
    }
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
          status: 'success', progress: 100, duration: result.duration,
          summary: result.summary, artifacts: result.artifacts,
        })
        appendHistory({
          id: createId(), toolId: tool.id, toolName: tool.name, status: 'success',
          startedAt, duration: result.duration, summary: result.summary,
          params: cloneValue(task.params), artifacts: result.artifacts,
        })
      } catch (error) {
        const cancelled = error?.name === 'AbortError'
        const duration = Date.now() - new Date(startedAt).getTime()
        updateQueueItem(task.id, {
          status: cancelled ? 'cancelled' : 'failed', duration,
          summary: cancelled ? '队列已停止' : error.message,
        })
        appendHistory({
          id: createId(), toolId: tool.id, toolName: tool.name,
          status: cancelled ? 'cancelled' : 'failed', startedAt, duration,
          summary: cancelled ? '队列已停止' : error.message,
          params: cloneValue(task.params), artifacts: [],
        })
        if (cancelled) break
      }
    }

    setQueueRunning(false)
    notify(controller.signal.aborted ? '任务队列已停止' : '任务队列运行结束')
  }

  const restoreHistory = (record) => {
    const tool = tools.find((item) => item.id === record.toolId)
    if (!tool) {
      notify('对应工具已不存在')
      return
    }
    openTool(tool, record.params ?? getDefaultParams(tool))
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
      setImportText('')
      setShowImport(false)
      openTool(result.manifest)
      notify('工具已通过校验并导入')
    } catch (error) {
      setImportErrors([`JSON 解析失败：${error.message}`])
    }
  }

  const commandActions = useMemo(() => [
    { id: 'page-home', label: '打开首页', hint: '导航', icon: 'home', run: () => navigate('home') },
    { id: 'page-library', label: '打开工具库', hint: '导航', icon: 'grid', run: () => navigate('library') },
    { id: 'page-tasks', label: '打开任务中心', hint: '导航', icon: 'queue', run: () => navigate('tasks') },
    { id: 'page-history', label: '打开运行历史', hint: '导航', icon: 'history', run: () => navigate('history') },
    { id: 'theme', label: theme === 'light' ? '切换为深色模式' : '切换为浅色模式', hint: '命令', icon: theme === 'light' ? 'moon' : 'sun', run: () => setTheme(theme === 'light' ? 'dark' : 'light') },
    { id: 'import', label: '导入自定义工具', hint: '命令', icon: 'upload', run: () => setShowImport(true) },
    ...tools.map((tool) => ({
      id: `tool-${tool.id}`, label: tool.name, hint: tool.description,
      icon: tool.icon, tool, run: () => openTool(tool),
    })),
  ], [theme, tools])

  const filteredCommands = useMemo(() => {
    const keyword = commandQuery.trim().toLowerCase()
    if (!keyword) return commandActions.slice(0, 12)
    return commandActions.filter((item) => `${item.label} ${item.hint}`.toLowerCase().includes(keyword)).slice(0, 18)
  }, [commandActions, commandQuery])

  const executeCommand = (item) => {
    item.run()
    setCommandOpen(false)
    setCommandQuery('')
  }

  const favoriteTools = tools.filter((tool) => favorites.includes(tool.id))
  const recentToolIds = [...new Set(history.map((item) => item.toolId))].slice(0, 6)
  const recentTools = recentToolIds.map((id) => tools.find((tool) => tool.id === id)).filter(Boolean)
  const latestRecord = history[0]
  const selectedRunState = runState?.toolId === selectedTool?.id ? runState : null
  const selectedLogs = runState?.toolId === selectedTool?.id ? logs : []
  const activeRunTool = tools.find((tool) => tool.id === runState?.toolId) ?? selectedTool

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}>
      <div className={`mobile-scrim ${mobileNavOpen ? 'is-visible' : ''}`} onClick={() => setMobileNavOpen(false)} />
      <Sidebar
        page={page}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileNavOpen}
        runtimeMode={runtime.mode}
        taskCount={activityCount}
        onNavigate={navigate}
        onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <main className="app-main">
        <Topbar
          page={page}
          selectedTool={selectedTool}
          activityCount={activityCount}
          onMenu={() => setMobileNavOpen(true)}
          onSearch={() => setCommandOpen(true)}
          onActivity={() => setActivityOpen(true)}
          onTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          theme={theme}
        />

        {page === 'home' && (
          <HomeView
            tools={tools}
            favorites={favoriteTools}
            recentTools={recentTools}
            history={history}
            latestRecord={latestRecord}
            queue={queue}
            runState={runState}
            onOpenTool={openTool}
            onOpenLibrary={() => navigate('library')}
            onRestore={restoreHistory}
            onOpenTasks={() => navigate('tasks')}
          />
        )}

        {page === 'library' && (
          <LibraryView
            tools={tools}
            favorites={favorites}
            category={libraryCategory}
            search={librarySearch}
            mode={libraryMode}
            onCategory={setLibraryCategory}
            onSearch={setLibrarySearch}
            onMode={setLibraryMode}
            onOpenTool={openTool}
            onFavorite={toggleFavorite}
            onImport={() => setShowImport(true)}
          />
        )}

        {page === 'workspace' && selectedTool && (
          <ToolWorkspace
            tool={selectedTool}
            params={params}
            presets={selectedPresets}
            favorite={favorites.includes(selectedTool.id)}
            runState={selectedRunState}
            logs={selectedLogs}
            runtimeMode={runtime.mode}
            onBack={() => navigate('library')}
            onParam={(key, value) => setParams((current) => ({ ...current, [key]: value }))}
            onFavorite={() => toggleFavorite(selectedTool.id)}
            onRun={runTool}
            onCancel={cancelRun}
            onQueue={addToQueue}
            onExport={() => {
              downloadText(`${selectedTool.id}.tool.json`, serializeToolManifest(selectedTool))
              notify('工具定义已导出')
            }}
            onSavePreset={savePreset}
            onLoadPreset={(preset) => setParams(cloneValue(preset.params))}
            onDeletePreset={deletePreset}
            onCopy={async (content) => {
              await copyText(content)
              notify('已复制到剪贴板')
            }}
          />
        )}

        {page === 'tasks' && (
          <TasksView
            queue={queue}
            tools={tools}
            running={queueRunning}
            onRun={runQueue}
            onStop={cancelRun}
            onOpenTool={(item) => {
              const tool = tools.find((toolItem) => toolItem.id === item.toolId)
              openTool(tool, item.params)
            }}
            onRemove={(id) => setQueue((items) => items.filter((item) => item.id !== id))}
            onRetry={(id) => updateQueueItem(id, { status: 'pending', progress: 0, summary: '等待运行' })}
            onClear={() => setQueue((items) => items.filter((item) => ['pending', 'running'].includes(item.status)))}
          />
        )}

        {page === 'history' && (
          <HistoryView history={history} tools={tools} onRestore={restoreHistory} onClear={() => setHistory([])} />
        )}

        {page === 'settings' && (
          <SettingsView
            theme={theme}
            collapsed={sidebarCollapsed}
            runtimeMode={runtime.mode}
            onTheme={setTheme}
            onCollapsed={setSidebarCollapsed}
          />
        )}
      </main>

      <ActivityDrawer
        open={activityOpen}
        queue={queue}
        tools={tools}
        runState={runState}
        selectedTool={activeRunTool}
        queueRunning={queueRunning}
        onClose={() => setActivityOpen(false)}
        onRunQueue={runQueue}
        onStop={cancelRun}
        onOpenTasks={() => { setActivityOpen(false); navigate('tasks') }}
        onRemove={(id) => setQueue((items) => items.filter((item) => item.id !== id))}
      />

      <CommandPalette
        open={commandOpen}
        query={commandQuery}
        items={filteredCommands}
        onQuery={setCommandQuery}
        onClose={() => { setCommandOpen(false); setCommandQuery('') }}
        onExecute={executeCommand}
      />

      {showImport && (
        <ImportModal
          value={importText}
          errors={importErrors}
          onChange={setImportText}
          onClose={() => setShowImport(false)}
          onImport={importTool}
        />
      )}

      {toast && <div className="toast"><Icon name="check" />{toast}</div>}
    </div>
  )
}

function Sidebar({ page, collapsed, mobileOpen, runtimeMode, taskCount, onNavigate, onToggleCollapse, onCloseMobile }) {
  const items = [
    { id: 'home', icon: 'home', label: '首页' },
    { id: 'library', icon: 'grid', label: '工具库' },
    { id: 'tasks', icon: 'queue', label: '任务', count: taskCount || undefined },
    { id: 'history', icon: 'history', label: '历史' },
    { id: 'settings', icon: 'settings', label: '设置' },
  ]
  return (
    <aside className={`sidebar ${mobileOpen ? 'is-mobile-open' : ''}`}>
      <div className="brand-row">
        <button className="brand-button" onClick={() => onNavigate('home')} aria-label="打开首页">
          <span className="brand-mark"><Icon name="spark" size={20} /></span>
          <span className="brand-copy"><strong>Tools Deck</strong><small>原生工具工作台</small></span>
        </button>
        <button className="icon-button sidebar-mobile-close" onClick={onCloseMobile} aria-label="关闭导航"><Icon name="x" /></button>
      </div>

      <nav className="sidebar-nav" aria-label="主导航">
        {items.map((item) => (
          <button
            key={item.id}
            className={`sidebar-nav__item ${page === item.id || (item.id === 'library' && page === 'workspace') ? 'is-active' : ''}`}
            onClick={() => onNavigate(item.id)}
            title={collapsed ? item.label : undefined}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {item.count ? <em>{item.count}</em> : null}
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className={`runtime-chip runtime-chip--${runtimeMode}`} title={runtimeMode === 'desktop' ? '桌面运行时' : 'Web 预览模式'}>
          <i /><span>{runtimeMode === 'desktop' ? '桌面运行时' : 'Web 预览'}</span>
        </div>
        <button className="sidebar-collapse" onClick={onToggleCollapse} title={collapsed ? '展开侧栏' : '收起侧栏'}>
          <Icon name={collapsed ? 'panel-right' : 'panel-left'} />
          <span>{collapsed ? '展开侧栏' : '收起侧栏'}</span>
        </button>
      </div>
    </aside>
  )
}

function Topbar({ page, selectedTool, activityCount, onMenu, onSearch, onActivity, onTheme, theme }) {
  const meta = page === 'workspace'
    ? { title: selectedTool?.name ?? '工具', subtitle: selectedTool?.description ?? '' }
    : PAGE_META[page] ?? PAGE_META.home
  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" onClick={onMenu} aria-label="打开导航"><Icon name="menu" /></button>
      <div className="topbar-title">
        <strong>{meta.title}</strong>
        <span>{meta.subtitle}</span>
      </div>
      <button className="command-trigger" onClick={onSearch}>
        <Icon name="search" />
        <span>搜索工具或输入命令</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div className="topbar-actions">
        <button className="icon-button activity-button" onClick={onActivity} aria-label="打开任务中心">
          <Icon name="activity" />
          {activityCount ? <b>{activityCount}</b> : null}
        </button>
        <button className="icon-button" onClick={onTheme} aria-label="切换主题"><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button>
      </div>
    </header>
  )
}

function HomeView({ tools, favorites, recentTools, history, latestRecord, queue, runState, onOpenTool, onOpenLibrary, onRestore, onOpenTasks }) {
  const activeQueue = queue.filter((item) => ['pending', 'running'].includes(item.status)).slice(0, 3)
  return (
    <div className="page page--home">
      <section className="welcome-panel">
        <div>
          <span className="eyebrow">WORKBENCH</span>
          <h1>继续你的工具任务</h1>
          <p>在一个专注工作区中配置、运行并管理本地工具。</p>
        </div>
        <button className="primary-button" onClick={onOpenLibrary}><Icon name="grid" />浏览全部工具</button>
      </section>

      {(runState?.status === 'running' || activeQueue.length > 0) && (
        <section className="home-section">
          <SectionHeader title="正在进行" subtitle="任务会在切换页面后继续运行" action={<button onClick={onOpenTasks}>查看全部</button>} />
          <div className="active-task-stack">
            {runState?.status === 'running' && (
              <article className="active-task-card is-running">
                <ToolIcon tool={tools.find((tool) => tool.id === runState.toolId) ?? tools[0]} />
                <div><strong>当前工具正在运行</strong><p>{runState.progress ?? 0}%</p><Progress value={runState.progress ?? 0} /></div>
              </article>
            )}
            {activeQueue.map((task) => {
              const tool = tools.find((item) => item.id === task.toolId)
              return (
                <article className="active-task-card" key={task.id}>
                  {tool ? <ToolIcon tool={tool} /> : <span className="tool-icon"><Icon name="alert" /></span>}
                  <div><strong>{task.toolName}</strong><p>{task.summary}</p><Progress value={task.progress ?? 0} /></div>
                  <StatusPill status={task.status} />
                </article>
              )
            })}
          </div>
        </section>
      )}

      {latestRecord && (
        <section className="home-section">
          <SectionHeader title="继续上次任务" subtitle="恢复上一次运行时使用的参数" />
          <article className="continue-card">
            <div className="continue-card__main">
              <span className={`result-mark result-mark--${latestRecord.status}`}><Icon name={latestRecord.status === 'success' ? 'check' : 'alert'} /></span>
              <div>
                <strong>{latestRecord.toolName}</strong>
                <p>{latestRecord.summary}</p>
                <small>{formatTime(latestRecord.startedAt)} · {durationText(latestRecord.duration)}</small>
              </div>
            </div>
            <div className="continue-card__actions">
              <button className="primary-button" onClick={() => onRestore(latestRecord)}><Icon name="sliders" />恢复参数</button>
            </div>
          </article>
        </section>
      )}

      <section className="home-section">
        <SectionHeader title="收藏工具" subtitle="快速打开最常用的工具" action={<button onClick={onOpenLibrary}>管理工具</button>} />
        {favorites.length ? (
          <div className="quick-tool-grid">
            {favorites.slice(0, 6).map((tool) => (
              <button className="quick-tool-card" key={tool.id} onClick={() => onOpenTool(tool)}>
                <ToolIcon tool={tool} size={22} />
                <span><strong>{tool.name}</strong><small>{tool.description}</small></span>
                <Icon name="arrow-up-right" />
              </button>
            ))}
          </div>
        ) : <EmptyState icon="star" title="还没有收藏工具" description="在工具库中点击星标，常用工具会显示在这里。" />}
      </section>

      <section className="home-section home-section--split">
        <div>
          <SectionHeader title="最近使用" subtitle="按最近运行顺序排列" />
          <div className="compact-list">
            {recentTools.length ? recentTools.map((tool) => {
              const record = history.find((item) => item.toolId === tool.id)
              return (
                <button key={tool.id} onClick={() => onOpenTool(tool)}>
                  <ToolIcon tool={tool} size={17} />
                  <span><strong>{tool.name}</strong><small>{record ? formatTime(record.startedAt) : '未运行'}</small></span>
                  <Icon name="chevron" />
                </button>
              )
            }) : <p className="muted-copy">运行工具后会在这里显示。</p>}
          </div>
        </div>
        <div className="home-library-summary">
          <span className="eyebrow">TOOLBOX</span>
          <strong>{tools.length} 个工具已就绪</strong>
          <p>包括文件、图片、数据、网络和开发工具。</p>
          <button className="secondary-button" onClick={onOpenLibrary}>打开工具库</button>
        </div>
      </section>
    </div>
  )
}

function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="section-header">
      <div><h2>{title}</h2><p>{subtitle}</p></div>
      {action}
    </div>
  )
}

function LibraryView({ tools, favorites, category, search, mode, onCategory, onSearch, onMode, onOpenTool, onFavorite, onImport }) {
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return tools.filter((tool) => {
      const categoryMatch = category === 'all' || tool.category === category
      const searchMatch = !keyword || [tool.name, tool.description, ...tool.tags].join(' ').toLowerCase().includes(keyword)
      return categoryMatch && searchMatch
    })
  }, [tools, category, search])

  return (
    <div className="page page--library">
      <div className="page-heading">
        <div><span className="eyebrow">LIBRARY</span><h1>选择一个工具开始工作</h1><p>{filtered.length} 个工具符合当前筛选条件</p></div>
        <button className="primary-button" onClick={onImport}><Icon name="plus" />导入工具</button>
      </div>

      <div className="library-toolbar">
        <label className="library-search"><Icon name="search" /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索名称、用途或标签" /></label>
        <div className="category-tabs">
          {categories.map((item) => <button key={item.id} className={category === item.id ? 'is-active' : ''} onClick={() => onCategory(item.id)}>{item.name}</button>)}
        </div>
        <div className="view-switch">
          <button className={mode === 'grid' ? 'is-active' : ''} onClick={() => onMode('grid')} aria-label="网格视图"><Icon name="grid" /></button>
          <button className={mode === 'list' ? 'is-active' : ''} onClick={() => onMode('list')} aria-label="列表视图"><Icon name="list" /></button>
        </div>
      </div>

      {filtered.length ? (
        <div className={`library-results library-results--${mode}`}>
          {filtered.map((tool) => (
            <article className="library-card" key={tool.id} onClick={() => onOpenTool(tool)}>
              <div className="library-card__top">
                <ToolIcon tool={tool} size={23} />
                <button className={`favorite-button ${favorites.includes(tool.id) ? 'is-active' : ''}`} onClick={(event) => { event.stopPropagation(); onFavorite(tool.id) }}><Icon name="star" /></button>
              </div>
              <div className="library-card__body"><h2>{tool.name}</h2><p>{tool.description}</p></div>
              <div className="library-card__footer"><span>{tool.tags.slice(0, 2).join(' · ')}</span><Icon name="arrow-up-right" /></div>
            </article>
          ))}
        </div>
      ) : <EmptyState title="没有找到工具" description="尝试更换分类或搜索关键词。" action={<button className="secondary-button" onClick={() => { onCategory('all'); onSearch('') }}>清除筛选</button>} />}
    </div>
  )
}

function ToolWorkspace({ tool, params, presets, favorite, runState, logs, runtimeMode, onBack, onParam, onFavorite, onRun, onCancel, onQueue, onExport, onSavePreset, onLoadPreset, onDeletePreset, onCopy }) {
  const [presetName, setPresetName] = useState('')
  const [logsOpen, setLogsOpen] = useState(false)
  const isTextTool = tool.id === 'json-formatter'
  const artifacts = runState?.artifacts ?? []

  useEffect(() => {
    setPresetName('')
    setLogsOpen(false)
  }, [tool.id])

  return (
    <div className="workspace-page">
      <header className="workspace-header">
        <button className="back-button" onClick={onBack}><Icon name="arrow-left" />工具库</button>
        <div className="workspace-title">
          <ToolIcon tool={tool} size={24} />
          <div><span className="eyebrow">{tool.category.toUpperCase()}</span><h1>{tool.name}</h1><p>{tool.description}</p></div>
        </div>
        <div className="workspace-header__actions">
          <button className="icon-button" onClick={onExport} title="导出工具定义"><Icon name="download" /></button>
          <button className={`icon-button favorite-button ${favorite ? 'is-active' : ''}`} onClick={onFavorite} title="收藏"><Icon name="star" /></button>
        </div>
      </header>

      {runtimeMode === 'preview' && tool.runtime.type !== 'builtin' && (
        <div className="runtime-notice"><Icon name="alert" /><span>当前处于 Web 预览模式，外部进程工具不会真正访问本地文件。</span></div>
      )}

      <div className={`workspace-content ${isTextTool ? 'workspace-content--editor' : ''}`}>
        {isTextTool ? (
          <TextToolLayout tool={tool} params={params} onParam={onParam} artifacts={artifacts} onCopy={onCopy} />
        ) : (
          <section className="workspace-card workspace-form-card">
            <div className="card-heading"><span><Icon name="sliders" /></span><div><h2>输入与参数</h2><p>选择数据并配置本次运行方式</p></div></div>
            <div className="parameter-grid">
              {tool.parameters.map((parameter) => <ParameterField key={parameter.key} parameter={parameter} value={params[parameter.key]} onChange={(value) => onParam(parameter.key, value)} />)}
            </div>
          </section>
        )}

        <PresetSection presets={presets} name={presetName} onName={setPresetName} onSave={() => { onSavePreset(presetName); setPresetName('') }} onLoad={onLoadPreset} onDelete={onDeletePreset} />

        <div className="workspace-actionbar">
          <div className="workspace-actionbar__hint"><kbd>Ctrl</kbd><kbd>Enter</kbd><span>运行当前工具</span></div>
          <div>
            <button className="secondary-button" onClick={onQueue}><Icon name="queue" />加入队列</button>
            {runState?.status === 'running'
              ? <button className="danger-button danger-button--auto" onClick={onCancel}><Icon name="stop" />停止</button>
              : <button className="primary-button primary-button--large" onClick={onRun}><Icon name="play" />运行工具</button>}
          </div>
        </div>

        <RunResult runState={runState} artifacts={artifacts} logs={logs} logsOpen={logsOpen} onToggleLogs={() => setLogsOpen((value) => !value)} onCopy={onCopy} />
      </div>
    </div>
  )
}

function TextToolLayout({ tool, params, onParam, artifacts, onCopy }) {
  const contentParameter = tool.parameters.find((item) => item.key === 'content')
  const result = artifacts.find((item) => item.type === 'text')?.content ?? ''
  return (
    <section className="editor-workbench">
      <div className="editor-pane">
        <div className="editor-pane__header"><strong>输入</strong><span>{String(params.content ?? '').length} 字符</span></div>
        <textarea value={params.content ?? ''} onChange={(event) => onParam('content', event.target.value)} placeholder={contentParameter?.placeholder} spellCheck="false" />
      </div>
      <div className="editor-options">
        {tool.parameters.filter((item) => item.key !== 'content').map((parameter) => <ParameterField key={parameter.key} parameter={parameter} value={params[parameter.key]} onChange={(value) => onParam(parameter.key, value)} compact />)}
      </div>
      <div className="editor-pane">
        <div className="editor-pane__header"><strong>输出</strong>{result ? <button onClick={() => onCopy(result)}><Icon name="copy" />复制</button> : <span>等待运行</span>}</div>
        <pre>{result || '运行工具后，格式化结果会显示在这里。'}</pre>
      </div>
    </section>
  )
}

function ParameterField({ parameter, value, onChange, compact = false }) {
  const className = `field ${compact ? 'field--compact' : ''} field--${parameter.type}`
  if (parameter.type === 'boolean') {
    return (
      <label className={`${className} switch-field`}>
        <span><strong>{parameter.label}</strong>{parameter.description ? <small>{parameter.description}</small> : null}</span>
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <i />
      </label>
    )
  }
  if (parameter.type === 'range') {
    return (
      <label className={className}>
        <span className="field-label"><strong>{parameter.label}</strong><em>{value}</em></span>
        <input type="range" min={parameter.min} max={parameter.max} value={value ?? parameter.default} onChange={(event) => onChange(Number(event.target.value))} />
      </label>
    )
  }
  if (parameter.type === 'select') {
    return (
      <label className={className}><span className="field-label"><strong>{parameter.label}</strong></span><select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>{parameter.options.map((option) => <option key={option}>{option}</option>)}</select></label>
    )
  }
  if (parameter.type === 'textarea') {
    return (
      <label className={className}><span className="field-label"><strong>{parameter.label}</strong>{parameter.required ? <em>必填</em> : null}</span><textarea value={value ?? ''} onChange={(event) => onChange(event.target.value)} placeholder={parameter.placeholder} spellCheck="false" /></label>
    )
  }
  if (['directory', 'files'].includes(parameter.type)) {
    return (
      <label className={className}>
        <span className="field-label"><strong>{parameter.label}</strong>{parameter.required ? <em>必填</em> : null}</span>
        <span className="path-input"><input value={value ?? ''} onChange={(event) => onChange(event.target.value)} placeholder={parameter.placeholder ?? '选择本地路径'} /><button type="button"><Icon name={parameter.type === 'files' ? 'file' : 'folder'} />浏览</button></span>
      </label>
    )
  }
  return (
    <label className={className}>
      <span className="field-label"><strong>{parameter.label}</strong>{parameter.required ? <em>必填</em> : null}</span>
      <input type={parameter.type === 'number' ? 'number' : 'text'} min={parameter.min} max={parameter.max} value={value ?? ''} onChange={(event) => onChange(parameter.type === 'number' ? Number(event.target.value) : event.target.value)} placeholder={parameter.placeholder} />
    </label>
  )
}

function PresetSection({ presets, name, onName, onSave, onLoad, onDelete }) {
  return (
    <section className="workspace-card preset-section">
      <div className="card-heading card-heading--inline"><span><Icon name="save" /></span><div><h2>参数预设</h2><p>保存常用配置，之后一键恢复</p></div><em>{presets.length}/12</em></div>
      <div className="preset-create"><input value={name} onChange={(event) => onName(event.target.value)} placeholder="预设名称（可选）" /><button onClick={onSave}>保存当前参数</button></div>
      {presets.length ? <div className="preset-list">{presets.map((preset) => <span className="preset-chip" key={preset.id}><button onClick={() => onLoad(preset)}>{preset.name}</button><button onClick={() => onDelete(preset.id)} aria-label="删除预设"><Icon name="x" size={13} /></button></span>)}</div> : <p className="muted-copy">还没有保存的预设。</p>}
    </section>
  )
}

function RunResult({ runState, artifacts, logs, logsOpen, onToggleLogs, onCopy }) {
  if (!runState) return null
  return (
    <section className={`workspace-card result-card result-card--${runState.status}`}>
      <div className="result-summary">
        <span className={`result-mark result-mark--${runState.status}`}><Icon name={runState.status === 'success' ? 'check' : runState.status === 'running' ? 'activity' : 'alert'} /></span>
        <div>
          <h2>{runState.status === 'running' ? '任务正在运行' : runState.status === 'success' ? '任务已完成' : runState.status === 'cancelled' ? '任务已取消' : '任务运行失败'}</h2>
          <p>{runState.result?.summary ?? logs.at(-1)?.message ?? '正在准备任务'}</p>
        </div>
        {runState.status === 'running' && <strong>{runState.progress ?? 0}%</strong>}
      </div>
      {runState.status === 'running' && <Progress value={runState.progress ?? 0} />}
      {artifacts.length ? <div className="artifact-grid">{artifacts.map((artifact, index) => <article key={`${artifact.label}-${index}`}><span><Icon name={artifact.type === 'text' ? 'code' : artifact.type === 'directory' ? 'folder' : 'file'} /></span><div><strong>{artifact.label}</strong><small>{artifact.path ?? artifact.type}</small></div>{artifact.content ? <button onClick={() => onCopy(artifact.content)}><Icon name="copy" />复制</button> : null}</article>)}</div> : null}
      <button className="log-toggle" onClick={onToggleLogs}><Icon name="terminal" />{logsOpen ? '收起运行日志' : `查看运行日志 (${logs.length})`}<Icon name={logsOpen ? 'chevron-up' : 'chevron-down'} /></button>
      {logsOpen && <div className="run-log">{logs.map((item, index) => <p className={`is-${item.level}`} key={`${item.time}-${index}`}><time>{new Date(item.time).toLocaleTimeString('zh-CN')}</time><span>{item.message}</span></p>)}</div>}
    </section>
  )
}

function Progress({ value }) {
  return <span className="progress-track"><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></span>
}

function TasksView({ queue, tools, running, onRun, onStop, onOpenTool, onRemove, onRetry, onClear }) {
  const counts = ['pending', 'running', 'success', 'failed'].map((status) => queue.filter((item) => item.status === status).length)
  return (
    <div className="page page--tasks">
      <div className="page-heading"><div><span className="eyebrow">ACTIVITY</span><h1>任务队列</h1><p>按顺序运行多个工具并集中查看状态</p></div><div className="page-actions">{running ? <button className="danger-button danger-button--auto" onClick={onStop}><Icon name="stop" />停止队列</button> : <button className="primary-button" onClick={onRun}><Icon name="play" />运行等待任务</button>}<button className="secondary-button" onClick={onClear}>清理已结束</button></div></div>
      <div className="summary-strip"><article><strong>{counts[0]}</strong><span>等待</span></article><article><strong>{counts[1]}</strong><span>运行中</span></article><article><strong>{counts[2]}</strong><span>已完成</span></article><article><strong>{counts[3]}</strong><span>失败</span></article></div>
      {queue.length ? <div className="task-list">{queue.map((task, index) => {
        const tool = tools.find((item) => item.id === task.toolId)
        return <article className={`task-card task-card--${task.status}`} key={task.id}><span className="task-index">{String(index + 1).padStart(2, '0')}</span>{tool ? <ToolIcon tool={tool} /> : <span className="tool-icon"><Icon name="alert" /></span>}<div className="task-card__body"><div><strong>{task.toolName}</strong><StatusPill status={task.status} /></div><p>{task.summary}</p>{task.status === 'running' ? <Progress value={task.progress ?? 0} /> : null}</div><div className="task-card__actions"><button onClick={() => onOpenTool(task)} title="打开工具"><Icon name="arrow-up-right" /></button>{['failed', 'cancelled'].includes(task.status) ? <button onClick={() => onRetry(task.id)} title="重试"><Icon name="retry" /></button> : null}<button onClick={() => onRemove(task.id)} disabled={task.status === 'running'} title="删除"><Icon name="trash" /></button></div></article>
      })}</div> : <EmptyState icon="queue" title="任务队列为空" description="在工具工作区点击“加入队列”，任务会显示在这里。" />}
    </div>
  )
}

function HistoryView({ history, tools, onRestore, onClear }) {
  return (
    <div className="page page--history">
      <div className="page-heading"><div><span className="eyebrow">HISTORY</span><h1>运行历史</h1><p>保留最近 100 次运行结果和参数</p></div>{history.length ? <button className="secondary-button" onClick={onClear}><Icon name="trash" />清空历史</button> : null}</div>
      {history.length ? <div className="history-list">{history.map((record) => {
        const tool = tools.find((item) => item.id === record.toolId)
        return <article key={record.id}><span className={`result-mark result-mark--${record.status}`}><Icon name={record.status === 'success' ? 'check' : 'alert'} /></span><div className="history-list__body"><div><strong>{record.toolName}</strong><StatusPill status={record.status} /></div><p>{record.summary}</p><small>{formatTime(record.startedAt)} · {durationText(record.duration)}</small></div><button className="secondary-button" disabled={!tool} onClick={() => onRestore(record)}>恢复参数</button></article>
      })}</div> : <EmptyState icon="history" title="还没有运行记录" description="完成工具任务后，参数和结果会显示在这里。" />}
    </div>
  )
}

function SettingsView({ theme, collapsed, runtimeMode, onTheme, onCollapsed }) {
  return (
    <div className="page page--settings">
      <div className="page-heading"><div><span className="eyebrow">SETTINGS</span><h1>应用设置</h1><p>调整界面外观和工作台行为</p></div></div>
      <div className="settings-grid">
        <section className="settings-card"><div className="card-heading"><span><Icon name="sun" /></span><div><h2>外观</h2><p>选择适合当前环境的显示主题</p></div></div><div className="segmented-control"><button className={theme === 'light' ? 'is-active' : ''} onClick={() => onTheme('light')}><Icon name="sun" />浅色</button><button className={theme === 'dark' ? 'is-active' : ''} onClick={() => onTheme('dark')}><Icon name="moon" />深色</button></div></section>
        <section className="settings-card"><div className="card-heading"><span><Icon name="panel-left" /></span><div><h2>侧栏</h2><p>控制导航栏默认显示方式</p></div></div><label className="setting-row"><span><strong>默认收起侧栏</strong><small>为工具工作区留出更多空间</small></span><input type="checkbox" checked={collapsed} onChange={(event) => onCollapsed(event.target.checked)} /></label></section>
        <section className="settings-card"><div className="card-heading"><span><Icon name="activity" /></span><div><h2>运行环境</h2><p>当前应用使用的工具执行模式</p></div></div><div className="runtime-setting"><i /><span><strong>{runtimeMode === 'desktop' ? 'Tauri 桌面运行时' : 'Web 预览模式'}</strong><small>{runtimeMode === 'desktop' ? '可以运行 Rust 原生工具和本地外部工具' : '仅用于界面预览和内置文本工具'}</small></span></div></section>
      </div>
    </div>
  )
}

function ActivityDrawer({ open, queue, tools, runState, selectedTool, queueRunning, onClose, onRunQueue, onStop, onOpenTasks, onRemove }) {
  const activeItems = queue.filter((item) => ['pending', 'running'].includes(item.status))
  return (
    <>
      <div className={`drawer-scrim ${open ? 'is-visible' : ''}`} onClick={onClose} />
      <aside className={`activity-drawer ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        <header><div><span className="eyebrow">ACTIVITY</span><h2>任务中心</h2></div><button className="icon-button" onClick={onClose}><Icon name="x" /></button></header>
        <div className="activity-drawer__body">
          {runState?.status === 'running' && selectedTool ? <article className="drawer-task is-running"><ToolIcon tool={selectedTool} /><div><strong>{selectedTool.name}</strong><p>当前任务 · {runState.progress}%</p><Progress value={runState.progress} /></div><button onClick={onStop}><Icon name="stop" /></button></article> : null}
          {activeItems.map((task) => {
            const tool = tools.find((item) => item.id === task.toolId)
            return <article className={`drawer-task ${task.status === 'running' ? 'is-running' : ''}`} key={task.id}>{tool ? <ToolIcon tool={tool} /> : <span className="tool-icon"><Icon name="alert" /></span>}<div><strong>{task.toolName}</strong><p>{task.summary}</p>{task.status === 'running' ? <Progress value={task.progress ?? 0} /> : null}</div>{task.status === 'pending' ? <button onClick={() => onRemove(task.id)}><Icon name="x" /></button> : null}</article>
          })}
          {!activeItems.length && runState?.status !== 'running' ? <EmptyState icon="activity" title="没有活动任务" description="加入队列或运行工具后，进度会显示在这里。" /> : null}
        </div>
        <footer>{activeItems.some((item) => item.status === 'pending') && !queueRunning && runState?.status !== 'running' ? <button className="primary-button" onClick={onRunQueue}><Icon name="play" />运行等待任务</button> : null}<button className="secondary-button" onClick={onOpenTasks}>打开完整任务页</button></footer>
      </aside>
    </>
  )
}

function CommandPalette({ open, query, items, onQuery, onClose, onExecute }) {
  const inputRef = useRef(null)
  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 30)
  }, [open])
  if (!open) return null
  return (
    <div className="command-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="command-palette" role="dialog" aria-modal="true">
        <label><Icon name="search" /><input ref={inputRef} value={query} onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && items[0]) onExecute(items[0]) }} placeholder="搜索工具、页面或命令" /><kbd>Esc</kbd></label>
        <div className="command-results">{items.length ? items.map((item, index) => <button key={item.id} className={index === 0 ? 'is-highlighted' : ''} onClick={() => onExecute(item)}><span className="command-icon"><Icon name={item.icon} /></span><span><strong>{item.label}</strong><small>{item.hint}</small></span><Icon name="chevron" /></button>) : <EmptyState title="没有匹配命令" description="尝试输入其他关键词。" />}</div>
        <footer><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></footer>
      </section>
    </div>
  )
}

function ImportModal({ value, errors, onChange, onClose, onImport }) {
  return (
    <div className="modal-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true">
        <header><div><span className="eyebrow">TOOL MANIFEST</span><h2>导入自定义工具</h2></div><button className="icon-button" onClick={onClose}><Icon name="x" /></button></header>
        <p>粘贴 JSON 工具定义。系统会校验工具 ID、分类、运行时和参数结构。</p>
        <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={'{\n  "id": "my-tool",\n  "name": "我的工具",\n  "category": "developer",\n  "parameters": []\n}'} spellCheck="false" />
        {errors.length ? <div className="error-stack"><Icon name="alert" /><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
        <footer><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" onClick={onImport}><Icon name="upload" />校验并导入</button></footer>
      </section>
    </div>
  )
}

export default App
