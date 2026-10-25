import { test, expect } from '@playwright/test'

test('unfolded sibling blocks move apart with their entire photo contents', async ({ page }) => {
  const data={trips:[],marks:[],entries:[{id:'e',entry_date:'2026-10-23',components:[],photos:['a','b'].map((id,i)=>({id,url:'/journal-demo/wuzhen.jpg',components:[],canvas_absolute:1,canvas_x:i*200,canvas_y:i*150,rotation:0}))}],canvas_groups:[{id:'a',name:'A',parent_id:'p',photo_ids:['a'],collapsed:true},{id:'b',name:'B',parent_id:'p',photo_ids:['b'],collapsed:true},{id:'p',name:'回忆',photo_ids:[],collapsed:false}],notebooks:[],notebook_items:[],notebook_pages:[]}
  let positions=[]
  await page.route('**/api/journal',r=>r.fulfill({json:data}))
  await page.route('**/api/journal/groups/a',async r=>{
    const changes=r.request().postDataJSON();positions=changes.positions||[]
    data.canvas_groups[0].collapsed=changes.collapsed
    for(const p of positions){const photo=data.entries[0].photos.find(i=>i.id===p.id);photo.canvas_x=p.x;photo.canvas_y=p.y}
    await r.fulfill({json:{id:'a',collapsed:changes.collapsed}})
  })
  await page.addInitScript(()=>localStorage.setItem('shitu-camera-v1',JSON.stringify({x:0,y:0,scale:.6,detail:true})))
  await page.goto('/')
  await page.getByRole('button',{name:'展开分组：A',exact:true}).click()
  await expect(page.getByRole('button',{name:'折叠分组：A',exact:true})).toBeVisible()
  expect(positions.map(p=>p.id)).toEqual(['a'])
  const a=await page.locator('[data-group-id="a"]').boundingBox(),b=await page.locator('[data-group-id="b"]').boundingBox()
  expect(a.x+a.width<=b.x || b.x+b.width<=a.x || a.y+a.height<=b.y || b.y+b.height<=a.y).toBe(true)
})

test('reader fills the window, names actions and fits bare image frames without a default scrollbar', async ({ page }) => {
  const data = { trips:[], marks:[], canvas_groups:[], entries:[{id:'entry',entry_date:'2026-10-23',components:[],photos:[{id:'photo',url:'/journal-demo/west-lake.jpg',components:[]}]}], notebooks:[{id:'book',name:'版面检查',canvas_x:0,canvas_y:0,last_read_page_id:'page0'}], notebook_pages:[0,1,2,3].map(i=>({id:'page'+i,notebook_id:'book',sort_order:i})), notebook_items:[{id:'photo',kind:'photo',page_id:'page0',x:400,y:400}] }
  await page.route('**/api/journal', route=>route.fulfill({json:data}))
  await page.goto('/')
  const header = await page.locator('.j-app-header').boundingBox()
  await expect(page.getByRole('link',{name:'个人资料'})).toHaveCount(0)
  expect(header.height).toBeGreaterThanOrEqual(56)
  expect(header.height).toBeLessThanOrEqual(59)
  await page.getByRole('button',{name:'打开手帐：版面检查'}).click()
  const reader = page.locator('.nb-reader'), box = await reader.boundingBox(), viewport = page.viewportSize()
  expect(box).toMatchObject({x:0,y:0,width:viewport.width,height:viewport.height})
  await expect(page.getByRole('button',{name:'放大纸页'})).toHaveAttribute('title','放大纸页')
  await expect(page.getByLabel('手札工具')).toHaveAttribute('title',/添加内容/)
  await expect(page.getByRole('button',{name:'合上手札'})).toHaveAttribute('title',/Esc/)
  const image = reader.locator('.nb-spread img')
  await expect(image).toBeVisible()
  await image.evaluate(img=>img.decode())
  await expect.poll(()=>image.evaluate(img=>Math.round(parseFloat(img.closest('button').style.height)-parseFloat(img.style.height)))).toBe(20)
  expect(await reader.locator('.nb-page-area').evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBeTruthy()
  await page.screenshot({path:'test-results/notebook-layout-light.png'})
  await page.emulateMedia({colorScheme:'dark'})
  await page.screenshot({path:'test-results/notebook-layout-dark.png'})
  await expect(page.getByRole('button',{name:'从画布挑选内容'})).toHaveCount(0)
  const colors=await reader.locator('.nb-heading-actions>.j-button,.nb-heading-actions summary').evaluateAll(buttons=>buttons.map(button=>getComputedStyle(button).backgroundColor))
  expect(new Set(colors).size).toBe(colors.length)
  expect(colors).not.toContain('rgba(0, 0, 0, 0)')
})

test('cover editor offers local photography, custom uploads, solid colors and text covers', async ({page})=>{
  const book={id:'book',name:'日常随笔',canvas_x:0,canvas_y:0,cover_mode:'photo',cover_url:'/notebook-covers/alpine-lake.jpg'}
  const data={trips:[],marks:[],canvas_groups:[],entries:[],notebooks:[book],notebook_pages:[0,1].map(i=>({id:'p'+i,notebook_id:'book',sort_order:i})),notebook_items:[]}
  const saved=[]
  await page.route('**/api/journal',r=>r.fulfill({json:data}))
  await page.route('**/api/journal/notebooks/book',r=>{const patch=r.request().postDataJSON();saved.push(patch);Object.assign(book,patch);return r.fulfill({json:book})})
  await page.route('**/api/journal/notebook-covers',r=>r.fulfill({status:201,json:{url:'/uploads/cover-ui.jpg'}}))
  await page.route('**/uploads/cover-ui.jpg',r=>r.fulfill({path:'public/journal-demo/wuzhen.jpg',contentType:'image/jpeg'}))
  await page.goto('/')
  await page.getByRole('button',{name:'打开手帐：日常随笔'}).click()
  async function settings(){await page.getByLabel('手札工具').click();await page.getByRole('button',{name:'名称与封面',exact:true}).click()}
  await settings()
  await expect(page.locator('.nb-photo-library img')).toHaveCount(6)
  for(const image of await page.locator('.nb-photo-library img').all()) await expect.poll(()=>image.evaluate(img=>img.complete&&img.naturalWidth>0)).toBeTruthy()
  await page.getByRole('button',{name:'林间晨光',exact:true}).click()
  await page.screenshot({path:'test-results/notebook-cover-editor.png'})
  await page.getByRole('button',{name:'保存手札'}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(saved.at(-1)).toMatchObject({cover_mode:'photo',cover_url:'/notebook-covers/misty-forest.jpg'})
  await settings()
  await page.getByRole('tab',{name:'纯色',exact:true}).click()
  await page.getByLabel('自定义颜色').fill('#273d34')
  await expect(page.getByLabel('封面预览').locator('img')).toHaveCount(0)
  await page.screenshot({path:'test-results/notebook-cover-solid.png'})
  await page.getByRole('button',{name:'保存手札'}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(saved.at(-1)).toMatchObject({cover_mode:'solid',cover_url:null,cover_color:'#273d34'})
  await settings()
  await expect(page.getByRole('tab',{name:'纯色',exact:true})).toHaveAttribute('aria-selected','true')
  await page.getByRole('tab',{name:'纯文字',exact:true}).click()
  await page.getByLabel('封面寄语').fill('记下平凡日子里的微光。')
  await page.emulateMedia({colorScheme:'dark'})
  await page.screenshot({path:'test-results/notebook-cover-text-dark.png'})
  await page.getByRole('button',{name:'保存手札'}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(saved.at(-1)).toMatchObject({cover_mode:'text',cover_url:null,cover_text:'记下平凡日子里的微光。'})
  await settings()
  await page.getByRole('tab',{name:'自定义上传',exact:true}).click()
  await page.getByLabel('上传封面图片',{exact:true}).setInputFiles('public/journal-demo/wuzhen.jpg')
  await expect(page.getByLabel('封面预览').locator('img')).toHaveAttribute('src',/^blob:/)
  await page.getByRole('button',{name:'保存手札'}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(saved.at(-1)).toMatchObject({cover_mode:'photo',cover_url:'/uploads/cover-ui.jpg'})
})
