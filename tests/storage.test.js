import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeStoredValue } from '../src/hooks/useLocalStorage.js'

test('refreshes built-in tool definitions and preserves custom tools', () => {
  const initial = [{
    id: 'builtin',
    name: '新版工具',
    runtime: { type: 'python', label: 'Python 3', status: 'ready' },
    execution: { entry: 'new.py' },
    parameters: [{ key: 'input', type: 'directory' }],
    output: { artifacts: [] },
  }]
  const stored = [
    {
      id: 'builtin',
      name: '旧版工具',
      runtime: { type: 'shell', label: '旧运行时', status: 'setup' },
      execution: { entry: 'old.sh' },
      parameters: [{ key: 'legacy', type: 'text' }],
      output: { artifacts: [{ type: 'file' }] },
      userField: 'preserved',
    },
    {
      id: 'custom',
      name: '自定义工具',
      runtime: { type: 'builtin' },
      parameters: [],
    },
  ]

  const result = mergeStoredValue(stored, initial)

  assert.equal(result[0].name, '新版工具')
  assert.equal(result[0].runtime.type, 'python')
  assert.equal(result[0].execution.entry, 'new.py')
  assert.equal(result[0].parameters[0].key, 'input')
  assert.equal(result[0].userField, 'preserved')
  assert.equal(result[1].id, 'custom')
})

test('leaves unrelated stored arrays unchanged', () => {
  const stored = [{ id: 'history-record', status: 'success' }]
  assert.equal(mergeStoredValue(stored, []), stored)
})
