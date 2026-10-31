import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'

// Inspect the real production graph: a static import of a deferred feature must
// fail this check even when the bundler moves it into a shared chunk.
const result = await build({ configLoader: 'runner', logLevel: 'error', build: { write: false } })
const chunks = result.output.filter(item => item.type === 'chunk')
const byFile = new Map(chunks.map(chunk => [chunk.fileName, chunk]))
const journal = chunks.find(chunk => chunk.moduleIds.some(id => id.replaceAll('\\', '/').endsWith('/journal/JournalPage.jsx')))
assert.ok(journal, 'The production build must contain the journal')
const initial = new Set()
function visit(chunk) {
  if (!chunk || initial.has(chunk)) return
  initial.add(chunk)
  chunk.imports.forEach(file => visit(byFile.get(file)))
}
visit(journal)
const modules = [...initial].flatMap(chunk => chunk.moduleIds).map(id => id.replaceAll('\\', '/'))
const deferred = modules.filter(id => /\/(?:PlaceAtlas|atlasGeography|atlasLayout|NotebookReader|EntryEditor|BackupDialog)\.[^/]+$|\/china-(?:boundary|provinces|places)\.json$/.test(id))
assert.deepEqual(deferred, [], 'Canvas startup must not preload atlas geography, reader, editor or backup modules')
assert.ok(Buffer.byteLength(journal.code) < 250_000, 'The journal chunk must stay below 250 kB')
const initialCssFiles = new Set([...initial].flatMap(chunk => [...(chunk.viteMetadata?.importedCss || [])]))
const initialCss = result.output.filter(item => item.type === 'asset' && initialCssFiles.has(item.fileName)).map(item => String(item.source)).join('\n')
assert.ok(initialCss.includes('.j-notebook-cover') && initialCss.includes('.nb-cover-art'), 'Canvas notebook covers must retain their styles before opening the deferred reader')
assert.ok(initialCss.includes('.j-view-switch') && initialCss.includes('.j-mobile-view-switch'), 'The shared view switch must be styled on initial canvas load, before loading the atlas')
for (const chunk of chunks) {
  console.log(`${chunk.fileName}: ${(Buffer.byteLength(chunk.code) / 1000).toFixed(2)} kB; gzip ${(gzipSync(chunk.code).length / 1000).toFixed(2)} kB`)
}
console.log('Canvas initial dependency graph excludes deferred features and geography.')
