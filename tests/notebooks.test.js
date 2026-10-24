import { expect, it } from 'vitest'
import { canvasData, pageItems, findPagePosition, itemKey, PAGE_WIDTH, PAGE_HEIGHT } from '../src/journal/notebooks'
import { buildCanvas, cardBounds, intersects } from '../src/journal/model'
it('reserves stable photo bounds before image decoding so placement cannot shrink obstacles', () => {
  const source = { trips: [], entries: [{ id:'e', entry_date:'2026-10-23', photos:[{id:'a',url:'/portrait',components:[{type:'description',value:'想留住这个瞬间。'.repeat(30)}]}] }], notebook_items:[{kind:'photo',id:'a',page_id:'p',x:600,y:800}] }
  const before = pageItems(source,'p')[0], after = pageItems(source,'p',{'/portrait':{width:400,height:2000}})[0]
  expect(before.layoutWidth).toBeGreaterThanOrEqual(after.layoutWidth)
  expect(before.layoutHeight).toBeGreaterThanOrEqual(after.layoutHeight)
})
it('fits a bare photo frame to the decoded image rather than the collision reservation', () => {
  const source = { trips: [], entries:[{id:'e',entry_date:'2026-10-23',components:[],photos:[{id:'a',url:'/wide',components:[]}]}], notebook_items:[{id:'a',kind:'photo',page_id:'p',x:600,y:800}] }
  const item = pageItems(source,'p',{'/wide':{width:1600,height:800}})[0]
  expect(item.width).toBe(520)
  expect(item.height).toBe(280)
  expect(item.layoutHeight).toBeGreaterThan(item.height)
})
const data = { trips: [], entries: [{ id:'e', entry_date:'2026-10-23', caption:'legacy', photos:[{id:'a',url:'/a'},{id:'b',url:'/b'}] },{id:'note',entry_date:'2026-10-23',photos:[],caption:'note'}],marks:[{id:'m',kind:'text',text:'hello',size:1,canvas_x:0,canvas_y:0}],canvas_groups:[{id:'g',photo_ids:['a','b']}],notebook_items:[{kind:'photo',id:'a',page_id:'p',x:400,y:500,rotation:12},{kind:'mark',id:'m',page_id:'p',x:700,y:900,rotation:0},{kind:'entry',id:'note',page_id:'q',x:200,y:200}] }
it('partitions mixed legacy content by item identity without mutating records or group membership',()=>{
 const snapshot=JSON.stringify(data), canvas=canvasData(data), page=pageItems(data,'p')
 expect(buildCanvas(canvas).items.map(itemKey)).toEqual(['photo:b'])
 expect(page.map(itemKey)).toEqual(['photo:a','mark:m'])
 expect(page[0]).toMatchObject({x:400,y:500,rotation:12,url:'/a'})
 expect(canvas.canvas_groups[0].photo_ids).toEqual(['b'])
 expect(JSON.stringify(data)).toBe(snapshot)
})
it('fits rotated landscape and portrait photos, reserves caption space and rejects a full page',()=>{
 const items=pageItems(data,'p',{'/a':{width:1800,height:900}})
 expect(items[0].height).toBeGreaterThanOrEqual(206)
 const existing=[]
 for(let i=0;i<8;i++) {
  const item={width:i%2?140:260,height:i%2?326:206,rotation:i%2?18:-12}
  const placed={...item,...findPagePosition(item,existing,{x:-100,y:1800})},box=cardBounds(placed)
  expect(box.x-box.w/2).toBeGreaterThanOrEqual(0)
  expect(box.y-box.h/2).toBeGreaterThanOrEqual(0)
  expect(box.x+box.w/2).toBeLessThanOrEqual(PAGE_WIDTH)
  expect(box.y+box.h/2).toBeLessThanOrEqual(PAGE_HEIGHT)
  expect(existing.some(other=>intersects(box,cardBounds(other)))).toBe(false)
  existing.push(placed)
 }
 expect(()=>findPagePosition({width:100,height:100},[{x:600,y:800,width:1200,height:1600}])).toThrow(/这一页.*放不下/)
})
it('preserves independent per-photo components and absolute placement through partitioning',()=>{
 const source={...data,entries:[{id:'record',entry_date:'2026-10-23',photos:[{id:'a',url:'/a',canvas_absolute:1,canvas_x:932,canvas_y:851,components:[{type:'description',value:'a'.repeat(600)}]},{id:'b',url:'/b',components:[{type:'description',value:'Other photo'}]}]}],marks:[]}
 const page=pageItems(source,'p',{'/a':{width:900,height:1800}})
 expect(page[0].entry.caption).toHaveLength(600)
 expect(page[0].entry.record_id).toBe('record')
 expect(page[0].imageHeight).toBe(240)
 expect(page[0].height).toBeGreaterThan(600)
 expect(page[0]).toMatchObject({x:400,y:500,canvas_x:932,canvas_y:851})
 expect(buildCanvas(canvasData(source)).items[0].entry.caption).toBe('Other photo')
})
