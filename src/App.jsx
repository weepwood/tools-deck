import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './components/Icon.jsx'
import { categories, initialTools } from './data/tools.js'
import { useLocalStorage } from './hooks/useLocalStorage.js'
import { createRuntime } from './runtime/runtime.js'

const runtime = createRuntime()

function getDefaultParams(tool) {
  return Object.fromEntries(
    tool.parameters.map((item) => [item.key, item.default ?? (item.type === 'boolean' ? false : '')]),
  )
}

function formatTime(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function durationText(ms) {
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} 秒`
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
  const [theme, setTheme] = useLocalStorage('tools-deck:theme', 'light')
  const [activeView, setActiveView] = useState('all')
  const [selectedId, setSelectedId] = useState(initialTools[0].id)
  const [search, setSearch] = useState('')
  const [params, setParams] = useState(() => getDefaultParams(initialTools[0]))
  const [runState, setRunState] = useState(null)
  const [logs, setLogs] = useState([])
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState('')
  const abortRef = useRef(null)

  const selectedTool = tools.find((tool) => tool.id === selectedId) ?? tools[0]

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    if (!selectedTool) return
    setParams(getDefaultParams(selectedTool))
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
    const ids = history.map((item) => item.toolId)
    return [...filteredTools].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
  }, [filteredTools, history])

  const visibleTools = activeView === 'recent' ? recentTools : filteredTools

  const toggleFavorite = (toolId) => {
    setFavorites((items) =>
      items.includes(toolId) ? items.filter((id) => id !== toolId) : [...items, toolId],
    )
  }

  const updateParam = (key, value) => {
    setParams((current) => ({ ...current, [key]: value }))
  }

  const validate = () => {
    const missing = selectedTool.parameters.find(
      (item) => item.required && String(params[item.key] ?? '').trim() === '',
    )
    if (missing) {
      setToast(`请先填写：${missing.label}`)
      return false
    }
    return true
  }

  const runTool = async () => {
    if (!validate() || runState?.status === 'running') return

    const controller = new AbortController()
    abortRef.current = controller
    const startedAt = new Date().toISOString()
    setLogs([{ time: Date.now(), message: `准备运行「${selectedTool.name}」`, level: 'info' }])
    setRunState({ status: 'running', progress: 2, startedAt })

    try {
      const result = await runtime.run({
        tool: selectedTool,
        params,
        signal: controller.signal,
        onProgress: ({ progress, message, level }) => {
          setRunState((current) => ({ ...current, progress }))
          setLogs((items) => [...items, { time: Date.now(), message, level }])
        },
      })

      const record = {
        id: crypto.randomUUID(),
        toolId: selectedTool.id,
        toolName: selectedTool.name,
        status: 'success',
        startedAt,
        duration: result.duration,
        summary: result.summary,
      }
      setHistory((items) => [record, ...items].slice(0, 100))
      setRunState({ status: 'success', progress: 100, startedAt, result })
      setToast('任务运行完成')
    } catch (error) {
      const cancelled = error?.name === 'AbortError'
      const duration = Date.now() - new Date(startedAt).getTime()
      const record = {
        id: crypto.randomUUID(),
        toolId: selectedTool.id,
        toolName: selectedTool.name,
        status: cancelled ? 'cancelled' : 'failed',
        startedAt,
        duration,
        summary: cancelled ? '用户取消了任务' : error.message,
      }
      setHistory((items) => [record, ...items].slice(0, 100))
      setRunState({ status: record.status, progress: 0, startedAt })
      setLogs((items) => [
        ...items,
        { time: Date.now(), message: record.summary, level: cancelled ? 'warning' : 'error' },
      ])
    }
  }

  const cancelRun = () => abortRef.current?.abort()

  const selectTool = (tool) => {
    setSelectedId(tool.id)
    setSidebarOpen(false)
  }

  const importTool = () => {
    setImportError('')
    try {
      const tool = JSON.parse(importText)
      if (!tool.id || !tool.name || !tool.category || !Array.isArray(tool.parameters)) {
        throw new Error('工具定义至少需要 id、name、category 和 parameters。')
      }
      if (tools.some((item) => item.id === tool.id)) {
        throw new Error(`工具 ID「${tool.id}」已存在。`)
      }
      const normalized = {
        description: '通过 JSON 定义导入的自定义工具。',
        icon: 'box',
        accent: 'blue',
        tags: ['自定义'],
        runtime: { type: 'custom', label: '自定义运行时', status: 'setup' },
        updatedAt: new Date().toISOString().slice(0, 10),
        ...tool,
      }
      setTools((items) => [...items, normalized])
      setSelectedId(normalized.id)
      setActiveView('all')
      setShowImport(false)
      setImportText('')
      setToast('工具已导入')
    } catch (error) {
      setImportError(error.message)
    }
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
          <button className="icon-button sidebar__close" onClick={() => setSidebarOpen(false)} aria-label="关闭导航">
            <Icon name="x" />
          </button>
        </div>

        <nav className="nav-section" aria-label="主导航">
          <p className="nav-label">工作台</p>
          <button className={`nav-item ${activeView === 'all' ? 'is-active' : ''}`} onClick={() => setActiveView('all')}>
            <Icon name="grid" /><span>全部工具</span><em>{tools.length}</em>
          </button>
          <button className={`nav-item ${activeView === 'favorites' ? 'is-active' : ''}`} onClick={() => setActiveView('favorites')}>
            <Icon name="star" /><span>我的收藏</span><em>{favorites.length}</em>
          </button>
          <button className={`nav-item ${activeView === 'recent' ? 'is-active' : ''}`} onClick={() => setActiveView('recent')}>
            <Icon name="clock" /><span>最近使用</span>
          </button>
          <button className={`nav-item ${activeView === 'history' ? 'is-active' : ''}`} onClick={() => setActiveView('history')}>
            <Icon name="history" /><span>运行记录</span><em>{history.length}</em>
          </button>
        </nav>

        <nav className="nav-section" aria-label="工具分类">
          <p className="nav-label">工具分类</p>
          {categories.slice(1).map((category) => (
            <button
              key={category.id}
              className={`nav-item ${activeView === category.id ? 'is-active' : ''}`}
              onClick={() => setActiveView(category.id)}
            >
              <Icon name={category.icon} /><span>{category.name}</span>
              <em>{tools.filter((tool) => tool.category === category.id).length}</em>
            </button>
          ))}
        </nav>

        <div className="sidebar-card">
          <span className="sidebar-card__icon"><Icon name="box" /></span>
          <div><strong>扩展你的工具库</strong><p>导入符合 Schema 的工具定义。</p></div>
          <button onClick={() => setShowImport(true)}>导入工具</button>
        </div>

        <div className="sidebar-footer">
          <button className="nav-item"><Icon name="settings" /><span>设置</span></button>
          <span className={`runtime-badge runtime-badge--${runtime.mode}`}>
            <i />{runtime.mode === 'desktop' ? '桌面运行时' : 'Web 预览模式'}
          </span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="打开导航">
            <Icon name="menu" />
          </button>
          <label className="search-box">
            <Icon name="search" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索工具、标签或运行环境" />
            <kbd>⌘ K</kbd>
          </label>
          <div className="topbar__actions">
            <button className="icon-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label="切换主题">
              <Icon name={theme === 'light' ? 'moon' : 'sun'} />
            </button>
            <button className="primary-button primary-button--compact" onClick={() => setShowImport(true)}>
              <Icon name="plus" />新建工具
            </button>
          </div>
        </header>

        {activeView === 'history' ? (
          <HistoryView history={history} tools={tools} onOpen={(toolId) => { setSelectedId(toolId); setActiveView('all') }} onClear={() => setHistory([])} />
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
                <article><span className="insight-icon insight-icon--orange"><Icon name="history" /></span><div><strong>{history.length}</strong><p>累计运行</p></div></article>
              </div>

              {visibleTools.length ? (
                <div className="tool-list">
                  {visibleTools.map((tool) => (
                    <article
                      key={tool.id}
                      className={`tool-card ${selectedTool?.id === tool.id ? 'is-selected' : ''}`}
                      onClick={() => selectTool(tool)}
                    >
                      <ToolIcon tool={tool} />
                      <div className="tool-card__body">
                        <div className="tool-card__title"><h2>{tool.name}</h2><span>{tool.runtime.label}</span></div>
                        <p>{tool.description}</p>
                        <div className="tag-row">{tool.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>
                      </div>
                      <button
                        className={`favorite-button ${favorites.includes(tool.id) ? 'is-active' : ''}`}
                        onClick={(event) => { event.stopPropagation(); toggleFavorite(tool.id) }}
                        aria-label="收藏工具"
                      >
                        <Icon name="star" />
                      </button>
                      <Icon name="chevron" className="tool-card__chevron" />
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState title="没有找到匹配工具" description="尝试更换分类或搜索关键词。" />
              )}
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
            <p className="modal__description">粘贴 JSON 工具定义。导入内容只保存在当前浏览器；桌面版将支持扫描本地工具目录。</p>
            <textarea
              className="manifest-editor"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={'{\n  "id": "my-tool",\n  "name": "我的工具",\n  "category": "developer",\n  "parameters": []\n}'}
              spellCheck="false"
            />
            {importError ? <div className="error-message"><Icon name="alert" />{importError}</div> : null}
            <div className="modal__actions">
              <button className="secondary-button" onClick={() => setShowImport(false)}>取消</button>
              <button className="primary-button" onClick={importTool}><Icon name="upload" />导入工具</button>
            </div>
          </section>
        </div>
      ) : null}

      {toast ? <div className="toast"><Icon name="check" />{toast}</div> : null}
    </div>
  )
}

function ToolDetail({ tool, params, onParamChange, favorite, onFavorite, runState, logs, onRun, onCancel }) {
  return (
    <aside className="detail-panel">
      <div className="detail-hero">
        <div className="detail-hero__top">
          <ToolIcon tool={tool} size={25} />
          <button className={`favorite-button ${favorite ? 'is-active' : ''}`} onClick={onFavorite}><Icon name="star" /></button>
        </div>
        <p className="eyebrow">{tool.category.toUpperCase()} TOOL</p>
        <h2>{tool.name}</h2>
        <p className="detail-description">{tool.description}</p>
        <div className="runtime-line"><span><i className={tool.runtime.status} />{tool.runtime.label}</span><em>更新于 {tool.updatedAt}</em></div>
      </div>

      <div className="detail-section">
        <div className="detail-section__heading"><div><p>PARAMETERS</p><h3>运行参数</h3></div><button onClick={() => tool.parameters.forEach((item) => onParamChange(item.key, item.default ?? ''))}>重置</button></div>
        <div className="parameter-form">
          {tool.parameters.map((parameter) => (
            <ParameterField key={parameter.key} parameter={parameter} value={params[parameter.key]} onChange={(value) => onParamChange(parameter.key, value)} />
          ))}
        </div>
      </div>

      <div className="run-box">
        {runState?.status === 'running' ? (
          <>
            <div className="progress-meta"><strong>正在运行</strong><span>{runState.progress}%</span></div>
            <div className="progress-track"><i style={{ width: `${runState.progress}%` }} /></div>
            <button className="danger-button" onClick={onCancel}><Icon name="stop" />停止任务</button>
          </>
        ) : (
          <button className="run-button" onClick={onRun}><Icon name="play" />运行工具<span>⌘ ↵</span></button>
        )}
        <p><Icon name="terminal" />运行时将校验参数并记录执行日志</p>
      </div>

      <div className="console-panel">
        <div className="console-panel__header"><span><i /><i /><i /></span><strong>执行日志</strong><em>{logs.length} 条</em></div>
        <div className="console-output">
          {logs.length ? logs.map((log, index) => (
            <div key={`${log.time}-${index}`} className={`log-line log-line--${log.level}`}>
              <time>{new Date(log.time).toLocaleTimeString('zh-CN', { hour12: false })}</time><span>{log.message}</span>
            </div>
          )) : <p className="console-placeholder">运行工具后，日志将在这里实时显示。</p>}
        </div>
      </div>
    </aside>
  )
}

function ParameterField({ parameter, value, onChange }) {
  const id = `param-${parameter.key}`

  if (parameter.type === 'boolean') {
    return (
      <label className="switch-field" htmlFor={id}>
        <div><strong>{parameter.label}</strong><span>{parameter.description ?? '启用后将在运行时应用该选项'}</span></div>
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <i />
      </label>
    )
  }

  if (parameter.type === 'range') {
    return (
      <label className="form-field" htmlFor={id}>
        <span>{parameter.label}<em>{value}</em></span>
        <input id={id} className="range-input" type="range" min={parameter.min} max={parameter.max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      </label>
    )
  }

  if (parameter.type === 'textarea') {
    return (
      <label className="form-field" htmlFor={id}>
        <span>{parameter.label}{parameter.required ? <b>*</b> : null}</span>
        <textarea id={id} value={value} placeholder={parameter.placeholder} onChange={(event) => onChange(event.target.value)} />
      </label>
    )
  }

  if (parameter.type === 'select') {
    return (
      <label className="form-field" htmlFor={id}>
        <span>{parameter.label}</span>
        <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
          {parameter.options.map((option) => <option key={option}>{option}</option>)}
        </select>
      </label>
    )
  }

  if (parameter.type === 'directory' || parameter.type === 'files') {
    return (
      <label className="form-field" htmlFor={id}>
        <span>{parameter.label}{parameter.required ? <b>*</b> : null}</span>
        <div className="path-input">
          <Icon name={parameter.type === 'files' ? 'file' : 'box'} />
          <input id={id} value={value} placeholder={parameter.placeholder ?? '输入或选择路径'} onChange={(event) => onChange(event.target.value)} />
          <button type="button" onClick={() => onChange(parameter.type === 'files' ? '已选择 3 个文件' : 'D:/Tools/input')}>浏览</button>
        </div>
      </label>
    )
  }

  return (
    <label className="form-field" htmlFor={id}>
      <span>{parameter.label}{parameter.required ? <b>*</b> : null}</span>
      <input
        id={id}
        type={parameter.type === 'number' ? 'number' : 'text'}
        min={parameter.min}
        max={parameter.max}
        value={value}
        placeholder={parameter.placeholder}
        onChange={(event) => onChange(parameter.type === 'number' ? Number(event.target.value) : event.target.value)}
      />
    </label>
  )
}

function HistoryView({ history, tools, onOpen, onClear }) {
  return (
    <section className="history-page">
      <div className="section-heading history-heading">
        <div><p>EXECUTION HISTORY</p><h1>运行记录</h1><span>保留最近 100 次执行结果</span></div>
        {history.length ? <button className="secondary-button" onClick={onClear}>清空记录</button> : null}
      </div>
      {history.length ? (
        <div className="history-table">
          <div className="history-row history-row--head"><span>工具</span><span>状态</span><span>运行时间</span><span>耗时</span><span /></div>
          {history.map((item) => {
            const tool = tools.find((entry) => entry.id === item.toolId)
            return (
              <div className="history-row" key={item.id}>
                <div className="history-tool">{tool ? <ToolIcon tool={tool} size={18} /> : null}<div><strong>{item.toolName}</strong><small>{item.summary}</small></div></div>
                <span className={`status-pill status-pill--${item.status}`}><i />{item.status === 'success' ? '成功' : item.status === 'cancelled' ? '已取消' : '失败'}</span>
                <time>{formatTime(item.startedAt)}</time>
                <span>{durationText(item.duration)}</span>
                <button className="link-button" onClick={() => onOpen(item.toolId)}>再次运行</button>
              </div>
            )
          })}
        </div>
      ) : <EmptyState icon="history" title="还没有运行记录" description="完成一次工具运行后，结果会出现在这里。" />}
    </section>
  )
}

export default App
