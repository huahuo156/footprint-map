import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useJournal } from '../src/journal/useJournal'
import { fetchJournal, saveNotebookReading } from '../src/lib/api'

vi.mock('../src/lib/api',async original=>({...await original(),fetchJournal:vi.fn(),saveNotebookReading:vi.fn()}))
const data={structure_version:'0',trips:[],entries:[],marks:[],notebooks:[{id:'book',last_read_page_id:null,bookmark_page_id:null}]}
beforeEach(()=>{vi.resetAllMocks();fetchJournal.mockResolvedValue(structuredClone(data))})
afterEach(cleanup)
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}

it('serializes rapid reading writes and keeps the latest optimistic page without a full reload',async()=>{
  const first=deferred(),second=deferred()
  saveNotebookReading.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const {result}=renderHook(useJournal)
  await waitFor(()=>expect(result.current.loading).toBe(false))
  let a,b
  act(()=>{a=result.current.changeNotebookReading('book',{last_read_page_id:'page1'});b=result.current.changeNotebookReading('book',{last_read_page_id:'page3'})})
  await waitFor(()=>expect(saveNotebookReading).toHaveBeenCalledTimes(1))
  expect(result.current.data.notebooks[0].last_read_page_id).toBe('page3')
  await act(async()=>{first.resolve({});await a})
  expect(saveNotebookReading).toHaveBeenNthCalledWith(2,'book',{last_read_page_id:'page3'})
  await act(async()=>{second.resolve({});await b})
  expect(fetchJournal).toHaveBeenCalledTimes(1)
})

it('rolls back only the failed bookmark without reloading a potentially edited layout',async()=>{
  const first=deferred(),second=deferred()
  saveNotebookReading.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const {result}=renderHook(useJournal)
  await waitFor(()=>expect(result.current.loading).toBe(false))
  let a,b
  act(()=>{a=result.current.changeNotebookReading('book',{bookmark_page_id:'page1'}).catch(error=>error);b=result.current.changeNotebookReading('book',{last_read_page_id:'page3'})})
  await waitFor(()=>expect(saveNotebookReading).toHaveBeenCalledTimes(1))
  fetchJournal.mockResolvedValue({...data,notebooks:[{...data.notebooks[0],last_read_page_id:'page3'}]})
  await act(async()=>{first.reject(new Error('保存失败'));await a})
  await act(async()=>{second.resolve({});await b})
  expect(result.current.data.notebooks[0]).toMatchObject({bookmark_page_id:null,last_read_page_id:'page3'})
  expect(fetchJournal).toHaveBeenCalledTimes(1)
})
it('rolls two failed queued writes back to the last confirmed value', async () => {
  const first=deferred(),second=deferred()
  saveNotebookReading.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const { result } = renderHook(useJournal)
  await waitFor(() => expect(result.current.loading).toBe(false))
  let a,b
  act(() => { a=result.current.changeNotebookReading('book',{bookmark_page_id:'page1'}).catch(error=>error); b=result.current.changeNotebookReading('book',{bookmark_page_id:'page3'}).catch(error=>error) })
  await waitFor(() => expect(saveNotebookReading).toHaveBeenCalledTimes(1))
  await act(async () => { first.reject(new Error('first failed')); await a })
  await act(async () => { second.reject(new Error('second failed')); await b })
  expect(result.current.data.notebooks[0].bookmark_page_id).toBe(null)
  expect(fetchJournal).toHaveBeenCalledTimes(1)
})
it.each([true, false])('preserves reading across an older refresh snapshot (write finishes first: %s)', async writeFirst => {
  const refresh=deferred(),write=deferred()
  saveNotebookReading.mockReturnValueOnce(write.promise)
  const { result } = renderHook(useJournal)
  await waitFor(() => expect(result.current.loading).toBe(false))
  fetchJournal.mockReturnValueOnce(refresh.promise)
  let reloading,reading
  act(() => { reloading=result.current.reload(); reading=result.current.changeNotebookReading('book',{last_read_page_id:'page3'}) })
  await waitFor(() => expect(saveNotebookReading).toHaveBeenCalledTimes(1))
  if (writeFirst) await act(async () => { write.resolve({}); await reading })
  await act(async () => { refresh.resolve(structuredClone(data)); await reloading })
  expect(result.current.data.notebooks[0].last_read_page_id).toBe('page3')
  if (!writeFirst) await act(async () => { write.resolve({}); await reading })
  expect(result.current.data.notebooks[0].last_read_page_id).toBe('page3')
})
