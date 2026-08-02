import Icon from './Icon.jsx'

const BATCH_STEPS = {
  'image-compressor': [
    ['选择图片', '指定输入和输出目录'],
    ['压缩配置', '设置质量与目录范围'],
    ['处理图片', '原生图像引擎批量执行'],
    ['查看结果', '打开压缩后的输出目录'],
  ],
  'batch-renamer': [
    ['选择目录', '读取需要重命名的文件'],
    ['命名规则', '设置前缀、序号和预览模式'],
    ['执行计划', '安全暂存并应用新文件名'],
    ['检查清单', '查看 CSV 重命名报告'],
  ],
  'excel-merger': [
    ['选择工作簿', '添加结构一致的 Excel 文件'],
    ['合并配置', '设置工作表与来源文件列'],
    ['合并数据', '读取并流式写入结果工作簿'],
    ['打开结果', '查看合并后的 Excel 文件'],
  ],
}

export function getWorkspaceTemplate(tool) {
  if (tool?.id === 'json-formatter') return 'text'
  if (BATCH_STEPS[tool?.id]) return 'batch'
  if (['http-batch-check', 'git-repo-audit'].includes(tool?.id)) return 'inspection'
  return 'form'
}

function requiredParamsReady(tool, params) {
  return (tool?.parameters ?? []).every((parameter) => {
    if (!parameter.required) return true
    const value = params?.[parameter.key]
    if (Array.isArray(value)) return value.length > 0
    return String(value ?? '').trim().length > 0
  })
}

export function BatchStepRail({ tool, params, runState }) {
  const steps = BATCH_STEPS[tool?.id]
  if (!steps) return null

  const inputReady = requiredParamsReady(tool, params)
  const currentIndex = runState?.status === 'success'
    ? 3
    : runState?.status === 'running'
      ? 2
      : inputReady
        ? 1
        : 0

  return (
    <section className="batch-stepper" aria-label="批处理步骤">
      {steps.map(([title, description], index) => {
        const complete = runState?.status === 'success' || index < currentIndex
        const active = index === currentIndex && runState?.status !== 'success'
        return (
          <article className={`${complete ? 'is-complete' : ''} ${active ? 'is-active' : ''}`} key={title}>
            <span>{complete ? <Icon name="check" size={15} /> : index + 1}</span>
            <div><strong>{title}</strong><small>{description}</small></div>
          </article>
        )
      })}
    </section>
  )
}

function parseStructuredArtifact(artifacts, expectedKind) {
  for (const artifact of artifacts ?? []) {
    if (!artifact?.content || typeof artifact.content !== 'string') continue
    try {
      const parsed = JSON.parse(artifact.content)
      if (parsed?.kind === expectedKind) return { artifact, data: parsed }
    } catch {
      // Normal file and text artifacts are not structured JSON payloads.
    }
  }
  return null
}

function HttpStatus({ status }) {
  const className = status >= 200 && status < 300
    ? 'is-success'
    : status >= 300 && status < 400
      ? 'is-redirect'
      : 'is-failed'
  return <span className={`http-status ${className}`}>{status || 'ERR'}</span>
}

function HttpInspectionResult({ data }) {
  const rows = Array.isArray(data.rows) ? data.rows : []
  return (
    <section className="inspection-result">
      <div className="inspection-summary">
        <article><span>检测总数</span><strong>{data.total ?? rows.length}</strong></article>
        <article className="is-success"><span>正常响应</span><strong>{data.success ?? 0}</strong></article>
        <article className="is-warning"><span>重定向</span><strong>{data.redirects ?? 0}</strong></article>
        <article className="is-danger"><span>失败</span><strong>{data.failed ?? 0}</strong></article>
        <article><span>平均响应</span><strong>{Math.round(data.averageDurationMs ?? 0)} ms</strong></article>
      </div>
      <div className="inspection-table-wrap">
        <table className="inspection-table">
          <thead><tr><th>URL</th><th>状态</th><th>响应时间</th><th>最终地址 / 错误</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.url}-${index}`}>
                <td title={row.url}><span className="truncate-cell">{row.url}</span></td>
                <td><HttpStatus status={Number(row.status ?? 0)} /></td>
                <td>{Number(row.durationMs ?? 0).toFixed(0)} ms</td>
                <td title={row.error || row.finalUrl}><span className={row.error ? 'inspection-error truncate-cell' : 'truncate-cell'}>{row.error || row.finalUrl}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function GitInspectionResult({ data }) {
  const changed = Array.isArray(data.changed) ? data.changed : []
  const staleBranches = Array.isArray(data.staleBranches) ? data.staleBranches : []
  return (
    <section className="inspection-result">
      <div className="inspection-summary inspection-summary--git">
        <article><span>当前分支</span><strong title={data.branch}>{data.branch || 'DETACHED HEAD'}</strong></article>
        <article className={changed.length ? 'is-warning' : 'is-success'}><span>工作区变更</span><strong>{changed.length}</strong></article>
        <article className={staleBranches.length ? 'is-warning' : 'is-success'}><span>长期未更新分支</span><strong>{staleBranches.length}</strong></article>
        <article><span>过期阈值</span><strong>{data.staleDays ?? 90} 天</strong></article>
      </div>
      <div className="git-result-grid">
        <article>
          <header><div><Icon name="file" /><strong>工作区状态</strong></div><span>{changed.length}</span></header>
          {changed.length
            ? <ul className="inspection-code-list">{changed.map((item, index) => <li key={`${item}-${index}`}><code>{item.slice(0, 2)}</code><span>{item.slice(2).trim()}</span></li>)}</ul>
            : <div className="inspection-empty"><Icon name="check" /><span>工作区干净</span></div>}
        </article>
        <article>
          <header><div><Icon name="history" /><strong>过期本地分支</strong></div><span>{staleBranches.length}</span></header>
          {staleBranches.length
            ? <ul className="inspection-branch-list">{staleBranches.map((item) => <li key={item}>{item}</li>)}</ul>
            : <div className="inspection-empty"><Icon name="check" /><span>没有长期未更新分支</span></div>}
        </article>
      </div>
      <p className="inspection-path" title={data.repository}><Icon name="folder" />{data.repository}</p>
    </section>
  )
}

export function InspectionResult({ tool, artifacts }) {
  if (tool?.id === 'http-batch-check') {
    const result = parseStructuredArtifact(artifacts, 'http-check')
    return result ? <HttpInspectionResult data={result.data} /> : null
  }
  if (tool?.id === 'git-repo-audit') {
    const result = parseStructuredArtifact(artifacts, 'git-audit')
    return result ? <GitInspectionResult data={result.data} /> : null
  }
  return null
}

export function ArtifactList({ artifacts, desktop, onCopy, onOpen, onReveal }) {
  if (!artifacts?.length) return null
  return (
    <div className="artifact-list">
      {artifacts.map((artifact, index) => {
        const hasPath = Boolean(artifact.path)
        const textContent = artifact.type === 'text' ? artifact.content : null
        return (
          <article className="artifact-item" key={`${artifact.label}-${index}`}>
            <span className="artifact-item__icon"><Icon name={artifact.type === 'text' ? 'code' : artifact.type === 'directory' ? 'folder' : 'file'} /></span>
            <div className="artifact-item__body">
              <strong>{artifact.label}</strong>
              <small title={artifact.path ?? artifact.type}>{artifact.path ?? artifact.type}</small>
            </div>
            <div className="artifact-item__actions">
              {hasPath && desktop ? <button onClick={() => onOpen(artifact)} title="使用默认应用打开"><Icon name="arrow-up-right" />打开</button> : null}
              {hasPath && desktop ? <button onClick={() => onReveal(artifact)} title="在文件管理器中定位"><Icon name="folder" />定位</button> : null}
              {hasPath ? <button onClick={() => onCopy(artifact.path)} title="复制本地路径"><Icon name="copy" />路径</button> : null}
              {textContent ? <button onClick={() => onCopy(textContent)} title="复制文本内容"><Icon name="copy" />复制</button> : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}
