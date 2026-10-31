// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest'
import express from 'express'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
const own = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', foreign = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const db = vi.hoisted(() => ({ run: null, connection: null }))
vi.mock('../server/db.js', () => ({ pool: { query: (...args) => db.run(...args), execute: (...args) => db.run(...args), getConnection: async () => db.connection } }))
vi.mock('../server/auth.js', () => ({ currentUserId: () => 'owner-a' }))
import { createJournalRouter } from '../server/journal.js'
import { backupRoutes, restoreArchive } from '../server/backup.js'
const servers = []
const directories = []
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir,{recursive:true,force:true}))); await Promise.all(servers.splice(0).map(s => new Promise(resolve => {s.closeAllConnections();s.close(resolve)}))) })
async function server() {
  const directory = await mkdtemp(path.join(tmpdir(),'ownership-'));directories.push(directory)
  const app = express(); app.use(express.json()); const router = createJournalRouter(directory)
  // Keep parser/validation/SQL real; only the process boundary and admission DB
  // are replaced because this suite uses an injected database instead of MySQL.
  backupRoutes(router,directory,{ acquireSlot: async () => async () => {}, runRestore: restoreArchive }); app.use(router)
  app.use((error,_req,res,_next) => res.status(error.status || 500).json({error:error.message}))
  const listener = app.listen(0,'127.0.0.1'); servers.push(listener)
  await new Promise(resolve => listener.once('listening',resolve)); return `http://127.0.0.1:${listener.address().port}`
}
function database(handler) {
  db.run = vi.fn(async (sql,args=[]) => {
    if (sql.startsWith('SELECT') && sql.includes('FROM journal_layout_state')) return [[{structure_version:'0'}]]
    // Queries against private roots/photos must bind a user identity.
    if (/^(SELECT|UPDATE|DELETE)/.test(sql) && /journal_(?:trips|entries|marks|photos|canvas_groups|notebooks)/.test(sql)) {
      expect(sql).toContain('owner_id'); expect(args).toContain('owner-a')
    }
    return handler(sql,args)
  })
  db.connection = { query: db.run, execute: db.run, beginTransaction:vi.fn(async()=>{}), commit:vi.fn(async()=>{}), rollback:vi.fn(async()=>{}), release:vi.fn() }
}
test('mixed account layout changes roll back without committing any item', async () => {
  database((sql,args) => sql.startsWith('SELECT') ? [args[0] === own ? [{id:own}] : []] : [{affectedRows:1}])
  const url = await server(); const result = await fetch(url+'/layout',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({items:[{kind:'mark',id:own,x:1,y:1},{kind:'mark',id:foreign,x:2,y:2}]})})
  expect(result.status).toBe(404); expect(db.connection.rollback).toHaveBeenCalledOnce(); expect(db.connection.commit).not.toHaveBeenCalled()
})
test('mixed photo deletion rejects the batch before deleting', async () => {
  database(sql => sql.includes('FROM journal_layout_state') ? [[{structure_version:'0'}]] : sql.startsWith('SELECT DISTINCT') ? [[{entry_id:own}]] : sql.startsWith('SELECT id,url') ? [[{id:own,url:'/journal-demo/x.jpg'}]] : [[]])
  const url = await server(); const result = await fetch(url+'/photos',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({photo_ids:[own,foreign]})})
  expect(result.status).toBe(404); expect(db.connection.rollback).toHaveBeenCalledOnce(); expect(db.run.mock.calls.some(([sql])=>sql.startsWith('DELETE'))).toBe(false)
})
test('trip insert ignores supplied owner and binds current account', async () => {
  database(sql => sql.includes('COUNT') ? [[{total:0}]] : sql.startsWith('INSERT') ? [{affectedRows:1}] : [[{id:own,name:'trip'}]])
  const url = await server(); const result = await fetch(url+'/trips',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'trip',owner_id:'forged'})})
  expect(result.status).toBe(201); const [sql,args] = db.run.mock.calls.find(([sql])=>sql.startsWith('INSERT')); expect(sql).toContain('owner_id');expect(args[0]).toBe('owner-a');expect(args).not.toContain('forged')
  expect(db.run.mock.calls.filter(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toHaveLength(1)
})
test('trip creation rejects stale structure before inserting', async () => {
  database(sql => sql.includes('COUNT') ? [[{total:0}]] : sql.startsWith('SELECT') ? [[{id:own}]] : [{affectedRows:1}])
  const url = await server(); const result = await fetch(url + '/trips', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'stale',expected_structure_version:'2'})})
  expect(result.status).toBe(409); expect(db.run.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false)
})
test('private journal and notebook snapshot scopes all reads', async () => {
  database(() => [[]]); const url=await server(); const result=await fetch(url+'/'); expect(result.status).toBe(200)
  for(const [sql,args] of db.run.mock.calls.filter(([sql]) => sql.startsWith('SELECT'))) {expect(sql).toContain('owner_id');expect(args).toContain('owner-a')}
})
test('restore gate is released after missing upload errors', async () => {
  database(() => [[]]);const url=await server()
  for(let i=0;i<2;i++){const result=await fetch(url+'/restore',{method:'POST'});expect(result.status).toBe(400)}
})
import { readZip, zipChunks } from '../server/zip.js'
test('backup exports only session-scoped tables', async () => {
  database(() => [[]]); const url=await server();const result=await fetch(url+'/backup');expect(result.status).toBe(200)
  const files=readZip(Buffer.from(await result.arrayBuffer()),{maxBytes:64*1024*1024}); const manifest=JSON.parse(files.get('backup.json'))
  expect(manifest.data.trips).toEqual([])
  const selects=db.run.mock.calls.filter(([sql])=>sql.startsWith('SELECT'))
  expect(selects).toHaveLength(12);for(const [sql,args] of selects){expect(sql).toContain('owner_id');expect(args).toContain('owner-a')}
})

async function restoreBody(data) {
  const chunks=[];for await(const chunk of zipChunks([{name:'backup.json',data:Buffer.from(JSON.stringify({format:'shitu-journal-backup',version:1,data}))}])) chunks.push(chunk)
  const form=new FormData();form.set('backup',new Blob([Buffer.concat(chunks)],{type:'application/zip'}),'backup.zip');return form
}
test('restore assigns session owner and replaces forged root ids', async () => {
  database(() => [[]]);const url=await server();const result=await fetch(url+'/restore',{method:'POST',body:await restoreBody({trips:[{id:own,name:'restored',owner_id:'forged'}]})})
  expect(result.status).toBe(200)
  const [sql,args]=db.run.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO journal_trips'));expect(sql).toContain('owner_id');expect(args[0]).toBe('owner-a');expect(args).not.toContain(own);expect(args).not.toContain('forged')
})
test('restore rejects a stale multipart structure token before inserting', async () => {
  database(() => [[]]); const url = await server()
  const form = await restoreBody({ trips: [{ id: own, name: 'stale restore' }] })
  form.set('expected_structure_version', '2')
  const result = await fetch(url + '/restore', { method: 'POST', body: form })
  expect(result.status).toBe(409)
  expect(db.run.mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false)
})
test('restore rejects reading references to a page in another notebook', async () => {
  database(() => [[]]);const url=await server();const result=await fetch(url+'/restore',{method:'POST',body:await restoreBody({notebooks:[{id:own,name:'one',bookmark_page_id:foreign},{id:'cccccccc-cccc-cccc-cccc-cccccccccccc',name:'two'}],notebook_pages:[{id:foreign,notebook_id:'cccccccc-cccc-cccc-cccc-cccccccccccc',sort_order:0}]})})
  expect(result.status).toBe(400);expect(db.run.mock.calls.some(([sql])=>sql.startsWith('INSERT'))).toBe(false)
})
