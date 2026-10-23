const demoFiles = { '浙江/西湖': 'west-lake', '浙江/乌镇': 'wuzhen', '上海/东方明珠': 'shanghai', '北京/故宫': 'palace', '北京/天坛': 'temple', '北京/颐和园': 'summer-palace', '北京/八达岭': 'great-wall', '四川/九寨沟': 'jiuzhaigou', '四川/黄龙': 'huanglong', '四川/峨眉山': 'emei', '四川/乐山大佛': 'leshan' }
const image = (region, place) => '/journal-demo/' + demoFiles[region + '/' + place] + '.jpg'
const trips = [
  { id: 'demo-beijing', name: '北京，慢慢走', region: '北京', color: 'sand', canvas_x: -800, canvas_y: 70 },
  { id: 'demo-jiangnan', name: '江南的五月', region: '杭州 / 乌镇 / 上海', color: 'sage', canvas_x: 0, canvas_y: -80 },
  { id: 'demo-sichuan', name: '走进山里', region: '四川', color: 'sky', canvas_x: 800, canvas_y: 90 },
]
const memories = [
  ['lake', 1, '2026-05-01', '西湖', '湖边坐了一下午，什么也没做。', '浙江', '西湖', 'bridge'],
  ['island', 1, '2026-05-01', '西湖', '风很轻，水也是。', '浙江', '西湖', 'island'],
  ['town', 1, '2026-05-02', '乌镇', '拐进一条没人的小巷。', '浙江', '乌镇'],
  ['city', 1, '2026-05-03', '上海 · 东方明珠', '这一天，以城市的灯光收尾。', '上海', '东方明珠'],
  ['palace', 0, '2025-10-01', '北京 · 故宫', '红墙下走得很慢。', '北京', '故宫'],
  ['temple', 0, '2025-10-02', '北京 · 天坛', '抬头看见一整片蓝。', '北京', '天坛'],
  ['summer', 0, '2025-10-03', '北京 · 颐和园', '沿着湖走。', '北京', '颐和园'],
  ['wall', 0, '2025-10-04', '北京 · 八达岭', '山脊上的风。', '北京', '八达岭'],
  ['jiuzhai', 2, '2026-03-12', '九寨沟', '水的颜色像不真实。', '四川', '九寨沟'],
  ['huanglong', 2, '2026-03-13', '黄龙', '走进高山的春天。', '四川', '黄龙'],
  ['emei', 2, '2026-03-14', '峨眉山', '云从脚边升起来。', '四川', '峨眉山'],
  ['leshan', 2, '2026-03-15', '乐山大佛', '在江边站了很久。', '四川', '乐山大佛'],
]
export const demoJournal = { trips, entries: memories.map(([key, trip, entry_date, place_name, caption, region, name, spot_key]) => ({ id: 'entry-' + key, trip_id: trips[trip].id, entry_date, place_name, caption, spot_key, mood: '平静', photos: [{ id: 'photo-' + key, url: image(region, name), crop_x: key === 'island' ? 15 : 50, image_filter: 'original', rotation: key.length % 2 ? -3 : 3 }] })) }
