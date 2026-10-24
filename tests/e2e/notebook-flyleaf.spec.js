import { test, expect } from '@playwright/test'

test('flyleaf turns into original pages and ribbon/resume follow page IDs after reopening and reordering',async({page})=>{
  const book={id:'book',name:'一些平凡的日子',cover_text:'把日子过慢一点。\n想起时，再翻一翻。',canvas_x:0,canvas_y:0,bookmark_page_id:null,last_read_page_id:null}
  const data={trips:[],entries:[],marks:[],canvas_groups:[],notebooks:[book],notebook_items:[],notebook_pages:Array.from({length:6},(_,i)=>({id:'p'+i,notebook_id:'book',sort_order:i}))}
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/api/journal',r=>r.fulfill({json:data}))
  await page.route('**/api/journal/notebooks/book/reading',r=>{const values=r.request().postDataJSON();Object.assign(book,values);return r.fulfill({json:{id:book.id,...values}})})
  async function open(){await page.goto('/');await page.getByRole('button',{name:'打开手帐：'+book.name}).click()}
  const count=page.getByLabel('手帐页码')
  await open()
  await expect(count).toHaveText('扉页 / 6')
  await expect(page.locator('.nb-spread .nb-flyleaf')).toHaveText(book.name+book.cover_text)
  await page.screenshot({path:'test-results/notebook-flyleaf-light.png'})
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.nb-turn-leaf')).toHaveCount(1)
  await page.screenshot({path:'test-results/notebook-flyleaf-turn.png'})
  await expect(count).toHaveText('1–2 / 6',{timeout:15000})
  await page.locator('.nb-spread [data-notebook-page="p0"]').click()
  await page.getByRole('button',{name:'夹住第1页'}).click()
  await expect.poll(()=>book.bookmark_page_id).toBe('p0')
  await expect(page.getByRole('button',{name:'取下第1页的书签'})).toBeEnabled()
  await page.emulateMedia({colorScheme:'dark'})
  await page.screenshot({path:'test-results/notebook-ribbon-dark.png'})
  await page.keyboard.press('ArrowRight')
  await expect(count).toHaveText('3–4 / 6',{timeout:15000})
  await expect.poll(()=>book.last_read_page_id).toBe('p3')
  await page.getByRole('button',{name:'合上手札'}).click()
  await open()
  await expect(count).toHaveText('3–4 / 6')
  await page.getByRole('button',{name:'翻到书签，第1页'}).click()
  await expect(count).toHaveText('1–2 / 6',{timeout:15000})
  await expect.poll(()=>book.last_read_page_id).toBe('p0')
  await page.getByRole('button',{name:'合上手札'}).click()
  const order=['p2','p3','p4','p5','p0','p1']
  for(const paper of data.notebook_pages) paper.sort_order=order.indexOf(paper.id)
  await open()
  await expect(count).toHaveText('5–6 / 6')
  await page.getByRole('button',{name:'取下第5页的书签'}).click()
  await expect.poll(()=>book.bookmark_page_id).toBeNull()
  expect(errors).toEqual([])
})

test('long titles and dedications remain on the flyleaf without covering the page turn corner',async({page})=>{
  const book={id:'book',name:'写给日常生活的一些话'.repeat(10),cover_text:'这是留给自己的寄语，愿每个平凡的日子都值得记住。\n'.repeat(18),canvas_x:0,canvas_y:0}
  const data={trips:[],entries:[],marks:[],canvas_groups:[],notebooks:[book],notebook_items:[],notebook_pages:[0,1].map(i=>({id:'p'+i,notebook_id:'book',sort_order:i}))}
  await page.route('**/api/journal',r=>r.fulfill({json:data}))
  await page.goto('/')
  await page.getByRole('button',{name:'打开手帐：'+book.name}).click()
  const paper=page.locator('.nb-spread .nb-flyleaf')
  expect(await paper.evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBeTruthy()
  const last=await paper.locator('p').boundingBox(),corner=await page.getByRole('button',{name:'翻到下一张纸'}).boundingBox()
  expect(last.y+last.height).toBeLessThan(corner.y)
})
