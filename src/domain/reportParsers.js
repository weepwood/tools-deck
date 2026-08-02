export function parseCsvLine(line) {
  const cells = []
  let value = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      cells.push(value)
      value = ''
    } else {
      value += character
    }
  }

  if (quoted) throw new Error('CSV 引号没有正确闭合。')
  cells.push(value)
  return cells
}

export function parseHttpReport(content) {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return null

  const headers = parseCsvLine(lines[0])
  const requiredHeaders = ['url', 'status', 'duration_ms', 'final_url', 'error']
  if (!requiredHeaders.every((header) => headers.includes(header))) {
    throw new Error('HTTP 检测报告缺少必要列。')
  }

  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  }).map((row) => ({
    url: row.url,
    status: Number(row.status || 0),
    durationMs: Number(row.duration_ms || 0),
    finalUrl: row.final_url,
    error: row.error,
  }))

  const success = rows.filter((row) => row.status >= 200 && row.status < 300).length
  const redirects = rows.filter((row) => row.status >= 300 && row.status < 400).length
  const failed = rows.length - success - redirects
  const averageDurationMs = rows.length
    ? rows.reduce((sum, row) => sum + row.durationMs, 0) / rows.length
    : 0

  return {
    kind: 'http-check',
    total: rows.length,
    success,
    redirects,
    failed,
    averageDurationMs,
    rows,
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function codeBlock(content, heading) {
  const escaped = escapeRegExp(heading)
  return content.match(new RegExp(`## ${escaped}\\s+\\x60\\x60\\x60text\\s*([\\s\\S]*?)\\x60\\x60\\x60`))?.[1]?.trim() ?? ''
}

export function parseGitReport(content) {
  const repository = content.match(/^- 仓库：(.+)$/m)?.[1]?.trim() ?? ''
  const branch = content.match(/^- 当前分支：(.+)$/m)?.[1]?.trim() ?? 'DETACHED HEAD'
  const staleDays = Number(content.match(/^- 过期分支阈值：(\d+) 天$/m)?.[1] ?? 90)
  const statusText = codeBlock(content, '工作区状态')
  const staleText = codeBlock(content, '过期本地分支')
  const changed = statusText && statusText !== '工作区干净'
    ? statusText.split(/\r?\n/).filter(Boolean)
    : []
  const staleBranches = staleText && staleText !== '无'
    ? staleText.split(/\r?\n/).filter(Boolean)
    : []

  return {
    kind: 'git-audit',
    repository,
    branch,
    staleDays,
    clean: changed.length === 0,
    changed,
    staleBranches,
  }
}
