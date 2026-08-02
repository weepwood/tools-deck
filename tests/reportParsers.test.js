import assert from 'node:assert/strict'
import test from 'node:test'

import { parseCsvLine, parseGitReport, parseHttpReport } from '../src/domain/reportParsers.js'

test('parseCsvLine handles commas and escaped quotes', () => {
  assert.deepEqual(
    parseCsvLine('"https://example.com/a,b","200","12.50","https://example.com","said ""ok"""'),
    ['https://example.com/a,b', '200', '12.50', 'https://example.com', 'said "ok"'],
  )
})

test('parseCsvLine rejects an unclosed quote', () => {
  assert.throws(() => parseCsvLine('"unfinished'), /引号没有正确闭合/)
})

test('parseHttpReport calculates summary values', () => {
  const report = [
    '\uFEFF"url","status","duration_ms","final_url","error"',
    '"https://ok.test","200","100.00","https://ok.test/",""',
    '"https://redirect.test","302","200.00","https://final.test/",""',
    '"https://failed.test","0","300.00","https://failed.test","timeout"',
  ].join('\n')

  const result = parseHttpReport(report)
  assert.equal(result.total, 3)
  assert.equal(result.success, 1)
  assert.equal(result.redirects, 1)
  assert.equal(result.failed, 1)
  assert.equal(result.averageDurationMs, 200)
  assert.equal(result.rows[2].error, 'timeout')
})

test('parseHttpReport rejects incompatible headers', () => {
  assert.throws(() => parseHttpReport('"url","status"\n"https://a.test","200"'), /缺少必要列/)
})

test('parseGitReport extracts repository status and stale branches', () => {
  const report = `# Git 仓库巡检报告

- 仓库：D:/Projects/demo
- 当前分支：main
- 过期分支阈值：90 天

## 工作区状态

\`\`\`text
 M  src/App.jsx
??  notes.txt
\`\`\`

## 过期本地分支

\`\`\`text
legacy (2025-01-01)
\`\`\`
`

  const result = parseGitReport(report)
  assert.equal(result.repository, 'D:/Projects/demo')
  assert.equal(result.branch, 'main')
  assert.equal(result.staleDays, 90)
  assert.equal(result.clean, false)
  assert.deepEqual(result.changed, ['M  src/App.jsx', '??  notes.txt'])
  assert.deepEqual(result.staleBranches, ['legacy (2025-01-01)'])
})

test('parseGitReport recognizes clean repositories', () => {
  const report = `# Git 仓库巡检报告

- 仓库：/tmp/demo
- 当前分支：main
- 过期分支阈值：30 天

## 工作区状态

\`\`\`text
工作区干净
\`\`\`

## 过期本地分支

\`\`\`text
无
\`\`\`
`

  const result = parseGitReport(report)
  assert.equal(result.clean, true)
  assert.deepEqual(result.changed, [])
  assert.deepEqual(result.staleBranches, [])
})
