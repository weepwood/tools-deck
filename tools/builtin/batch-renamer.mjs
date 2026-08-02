#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PREFIX = '::tools-deck::'
const params = JSON.parse(process.env.TOOLS_DECK_PARAMS_JSON ?? '{}')
const emit = (payload) => console.log(`${PREFIX}${JSON.stringify(payload)}`)

const directory = path.resolve(String(params.directory ?? ''))
const prefix = String(params.prefix ?? 'file-')
const start = Number(params.start ?? 1)
const dryRun = Boolean(params.dryRun)

const stat = await fs.stat(directory)
if (!stat.isDirectory()) throw new Error('目标路径不是目录')

const entries = (await fs.readdir(directory, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }))

const plans = entries.map((entry, index) => {
  const extension = path.extname(entry.name)
  const nextName = `${prefix}${String(start + index).padStart(4, '0')}${extension}`
  return {
    sourceName: entry.name,
    targetName: nextName,
    source: path.join(directory, entry.name),
    target: path.join(directory, nextName),
  }
})

const targetNames = new Set()
for (const plan of plans) {
  const normalized = process.platform === 'win32' ? plan.targetName.toLowerCase() : plan.targetName
  if (targetNames.has(normalized)) throw new Error(`生成了重复文件名：${plan.targetName}`)
  targetNames.add(normalized)
}

emit({ type: 'progress', progress: 5, message: `找到 ${entries.length} 个文件` })
const rows = []
for (let index = 0; index < plans.length; index += 1) {
  const plan = plans[index]
  rows.push([plan.sourceName, plan.targetName, dryRun ? 'preview' : 'renamed'])

  if (!dryRun && plan.source !== plan.target) {
    try {
      await fs.access(plan.target)
      const targetIsOriginal = plans.some((item) => item.source === plan.target)
      if (!targetIsOriginal) throw new Error(`目标文件已存在：${plan.targetName}`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    const temporary = `${plan.source}.tools-deck-${process.pid}-${index}`
    await fs.rename(plan.source, temporary)
    plan.temporary = temporary
  }

  emit({
    type: 'progress',
    progress: Math.min(70, 5 + Math.round(((index + 1) / Math.max(plans.length, 1)) * 65)),
    message: `${plan.sourceName} → ${plan.targetName}`,
  })
}

if (!dryRun) {
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index]
    if (plan.temporary) await fs.rename(plan.temporary, plan.target)
    emit({
      type: 'progress',
      progress: Math.min(95, 70 + Math.round(((index + 1) / Math.max(plans.length, 1)) * 25)),
      message: `已写入 ${plan.targetName}`,
    })
  }
}

const outputDir = path.join(os.tmpdir(), 'tools-deck', process.env.TOOLS_DECK_RUN_ID ?? 'run')
await fs.mkdir(outputDir, { recursive: true })
const report = path.join(outputDir, 'rename-plan.csv')
const csv = ['原文件名,新文件名,状态', ...rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))].join('\n')
await fs.writeFile(report, `\uFEFF${csv}\n`, 'utf8')
emit({ type: 'artifact', progress: 100, artifact: { type: 'file', label: dryRun ? '重命名预览清单' : '重命名结果清单', path: report, content: report } })
console.log(dryRun ? `预览完成：${entries.length} 个文件` : `重命名完成：${entries.length} 个文件`)
