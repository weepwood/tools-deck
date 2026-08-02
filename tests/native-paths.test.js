import test from 'node:test'
import assert from 'node:assert/strict'
import { getPathSelectionType } from '../src/runtime/nativePaths.js'

function containerWithIcon(icon) {
  return {
    querySelector() {
      return { dataset: { icon } }
    },
  }
}

test('uses multiple file selection for file parameters', () => {
  assert.equal(getPathSelectionType(containerWithIcon('file')), 'files')
})

test('uses directory selection for directory parameters', () => {
  assert.equal(getPathSelectionType(containerWithIcon('box')), 'directory')
  assert.equal(getPathSelectionType(null), 'directory')
})
