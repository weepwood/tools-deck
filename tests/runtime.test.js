import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../src/runtime/runtime.js'

test('runs the built-in JSON formatter with sorted keys', async () => {
  const runtime = createRuntime()
  const events = []
  const result = await runtime.run({
    tool: { id: 'json-formatter', name: 'JSON 格式化', runtime: { type: 'builtin', label: '内置工具' } },
    params: { content: '{"b":1,"a":{"d":2,"c":3}}', indent: '2', sortKeys: true },
    signal: new AbortController().signal,
    onProgress: (event) => events.push(event),
  })

  assert.equal(result.artifacts[0].content, '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}')
  assert.equal(events.at(-1).progress, 100)
})

test('reports invalid JSON as an execution error', async () => {
  const runtime = createRuntime()

  await assert.rejects(
    runtime.run({
      tool: { id: 'json-formatter', name: 'JSON 格式化', runtime: { type: 'builtin', label: '内置工具' } },
      params: { content: '{invalid}', indent: '2', sortKeys: false },
      signal: new AbortController().signal,
      onProgress: () => {},
    }),
    SyntaxError,
  )
})
