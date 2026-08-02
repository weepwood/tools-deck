import test from 'node:test'
import assert from 'node:assert/strict'
import { serializeToolManifest, validateToolManifest } from '../src/domain/manifest.js'

test('accepts and normalizes a valid manifest', () => {
  const result = validateToolManifest({
    id: 'sample-tool',
    name: '示例工具',
    category: 'developer',
    runtime: { type: 'builtin' },
    parameters: [{ key: 'content', label: '内容', type: 'textarea', required: true }],
  })

  assert.equal(result.valid, true)
  assert.equal(result.manifest.runtime.status, 'ready')
  assert.equal(result.manifest.parameters[0].required, true)
})

test('rejects unsafe ids and duplicate parameter keys', () => {
  const result = validateToolManifest({
    id: 'Bad Tool',
    name: '错误示例',
    category: 'developer',
    parameters: [
      { key: 'value', type: 'text' },
      { key: 'value', type: 'text' },
    ],
  })

  assert.equal(result.valid, false)
  assert.match(result.errors.join('\n'), /小写字母/)
  assert.match(result.errors.join('\n'), /重复/)
})

test('rejects an existing tool id', () => {
  const result = validateToolManifest(
    { id: 'sample-tool', name: '示例', category: 'file', parameters: [] },
    { existingIds: ['sample-tool'] },
  )

  assert.equal(result.valid, false)
  assert.match(result.errors[0], /已存在/)
})

test('serializes only portable manifest fields', () => {
  const output = serializeToolManifest({
    id: 'sample-tool',
    name: '示例',
    description: '说明',
    category: 'file',
    icon: 'file',
    accent: 'blue',
    tags: ['示例'],
    runtime: { type: 'custom' },
    parameters: [],
    output: { artifacts: [] },
    internalState: 'do-not-export',
  })

  assert.equal(output.includes('internalState'), false)
  assert.equal(output.endsWith('\n'), true)
})
