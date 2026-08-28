/**
 * 景点图片数据库
 * 使用真实的景点图片，来源于 Wikimedia Commons、Flickr 等
 * 数据来源：https://github.com/marksui/China-Travel-Map
 */

// GitHub 仓库的基础 URL
const GITHUB_BASE = 'https://raw.githubusercontent.com/marksui/China-Travel-Map/main/assets/images'

// 景点图片映射（按景点名称）
// 使用真实的景点照片，每张都是该景点的代表性图片
export const LANDMARK_IMAGES = {
  // 北京
  '故宫博物院': `${GITHUB_BASE}/北京/故宫.jpg`,
  '天坛公园': `${GITHUB_BASE}/北京/天坛.jpg`,
  '颐和园': `${GITHUB_BASE}/北京/颐和园.jpg`,
  '长城·八达岭': `${GITHUB_BASE}/北京/八达岭.jpg`,
  '八达岭长城': `${GITHUB_BASE}/北京/八达岭.jpg`,

  // 天津
  '古文化街': `${GITHUB_BASE}/天津/古文化街.jpg`,
  '五大道': `${GITHUB_BASE}/天津/五大道.jpg`,
  '天津之眼': `${GITHUB_BASE}/天津/天津之眼.jpg`,

  // 河北
  '山海关': `${GITHUB_BASE}/河北/山海关.jpg`,
  '白洋淀': `${GITHUB_BASE}/河北/白洋淀.jpg`,
  '承德避暑山庄': `${GITHUB_BASE}/河北/避暑山庄.jpg`,

  // 山西
  '云冈石窟': `${GITHUB_BASE}/山西/云冈石窟.jpg`,
  '五台山': `${GITHUB_BASE}/山西/五台山.jpg`,
  '平遥古城': `${GITHUB_BASE}/山西/平遥古城.jpg`,

  // 内蒙古
  '呼伦贝尔大草原': `${GITHUB_BASE}/内蒙古/呼伦贝尔大草原.jpg`,
  '额济纳胡杨林': `${GITHUB_BASE}/内蒙古/额济纳胡杨林.jpg`,

  // 辽宁
  '沈阳故宫': `${GITHUB_BASE}/辽宁/沈阳故宫.jpg`,
  '星海广场': `${GITHUB_BASE}/辽宁/星海广场.jpg`,
  '本溪水洞': `${GITHUB_BASE}/辽宁/本溪水洞.jpg`,

  // 吉林
  '长白山天池': `${GITHUB_BASE}/吉林/长白山天池.jpg`,
  '雾凇岛': `${GITHUB_BASE}/吉林/雾凇岛.jpg`,
  '净月潭': `${GITHUB_BASE}/吉林/净月潭.jpg`,

  // 黑龙江
  '太阳岛': `${GITHUB_BASE}/黑龙江/太阳岛.jpg`,
  '五大连池': `${GITHUB_BASE}/黑龙江/五大连池.jpg`,
  '冰雪大世界': `${GITHUB_BASE}/黑龙江/冰雪大世界.jpg`,

  // 上海
  '外滩': `${GITHUB_BASE}/上海/外滩.jpg`,
  '东方明珠': `${GITHUB_BASE}/上海/东方明珠.jpg`,
  '豫园': `${GITHUB_BASE}/上海/豫园.jpg`,

  // 江苏
  '拙政园': `${GITHUB_BASE}/江苏/拙政园.jpg`,
  '中山陵': `${GITHUB_BASE}/江苏/中山陵.jpg`,
  '夫子庙': `${GITHUB_BASE}/江苏/夫子庙.jpg`,
  '瘦西湖': `${GITHUB_BASE}/江苏/瘦西湖.jpg`,
  '鼋头渚': `${GITHUB_BASE}/江苏/鼋头渚.jpg`,
  '周庄古镇': `${GITHUB_BASE}/江苏/周庄古镇.jpg`,

  // 浙江
  '西湖': `${GITHUB_BASE}/浙江/西湖.jpg`,
  '千岛湖': `${GITHUB_BASE}/浙江/千岛湖.jpg`,
  '乌镇': `${GITHUB_BASE}/浙江/乌镇.jpg`,

  // 安徽
  '黄山': `${GITHUB_BASE}/安徽/黄山.jpg`,
  '九华山': `${GITHUB_BASE}/安徽/九华山.jpg`,
  '西递宏村': `${GITHUB_BASE}/安徽/西递宏村.jpg`,

  // 福建
  '鼓浪屿': `${GITHUB_BASE}/福建/鼓浪屿.jpg`,
  '武夷山': `${GITHUB_BASE}/福建/武夷山.jpg`,
  '土楼': `${GITHUB_BASE}/福建/土楼.jpg`,

  // 江西
  '庐山': `${GITHUB_BASE}/江西/庐山.jpg`,
  '三清山': `${GITHUB_BASE}/江西/三清山.jpg`,
  '婺源': `${GITHUB_BASE}/江西/婺源.jpg`,

  // 山东
  '泰山': `${GITHUB_BASE}/山东/泰山.jpg`,
  '崂山': `${GITHUB_BASE}/山东/崂山.jpg`,
  '蓬莱阁': `${GITHUB_BASE}/山东/蓬莱阁.jpg`,
  '栈桥': `${GITHUB_BASE}/山东/栈桥.jpg`,

  // 河南
  '龙门石窟': `${GITHUB_BASE}/河南/龙门石窟.jpg`,
  '少林寺': `${GITHUB_BASE}/河南/少林寺.jpg`,
  '云台山': `${GITHUB_BASE}/河南/云台山.jpg`,
  '清明上河园': `${GITHUB_BASE}/河南/清明上河园.jpg`,

  // 湖北
  '黄鹤楼': `${GITHUB_BASE}/湖北/黄鹤楼.jpg`,
  '武当山': `${GITHUB_BASE}/湖北/武当山.jpg`,
  '神农架': `${GITHUB_BASE}/湖北/神农架.jpg`,
  '三峡大坝': `${GITHUB_BASE}/湖北/三峡大坝.jpg`,

  // 湖南
  '张家界国家森林公园': `${GITHUB_BASE}/湖南/张家界.jpg`,
  '凤凰古城': `${GITHUB_BASE}/湖南/凤凰古城.jpg`,
  '岳阳楼': `${GITHUB_BASE}/湖南/岳阳楼.jpg`,
  '衡山': `${GITHUB_BASE}/湖南/衡山.jpg`,

  // 广东
  '广州塔': `${GITHUB_BASE}/广东/广州塔.jpg`,
  '深圳世界之窗': `${GITHUB_BASE}/广东/深圳世界之窗.jpg`,
  '开平碉楼': `${GITHUB_BASE}/广东/开平碉楼.jpg`,
  '珠海渔女': `${GITHUB_BASE}/广东/珠海渔女.jpg`,
  '佛山祖庙': `${GITHUB_BASE}/广东/佛山祖庙.jpg`,

  // 广西
  '漓江': `${GITHUB_BASE}/广西/漓江.jpg`,
  '德天瀑布': `${GITHUB_BASE}/广西/德天瀑布.jpg`,
  '象鼻山': `${GITHUB_BASE}/广西/象鼻山.jpg`,
  '北海银滩': `${GITHUB_BASE}/广西/北海银滩.jpg`,

  // 海南
  '三亚亚龙湾': `${GITHUB_BASE}/海南/三亚亚龙湾.jpg`,
  '南山文化旅游区': `${GITHUB_BASE}/海南/南山文化旅游区.jpg`,
  '蜈支洲岛': `${GITHUB_BASE}/海南/蜈支洲岛.jpg`,
  '天涯海角': `${GITHUB_BASE}/海南/天涯海角.jpg`,

  // 重庆
  '洪崖洞': `${GITHUB_BASE}/重庆/洪崖洞.jpg`,
  '磁器口古镇': `${GITHUB_BASE}/重庆/磁器口古镇.jpg`,
  '长江索道': `${GITHUB_BASE}/重庆/长江索道.jpg`,
  '大足石刻': `${GITHUB_BASE}/重庆/大足石刻.jpg`,

  // 四川
  '九寨沟': `${GITHUB_BASE}/四川/九寨沟.jpg`,
  '峨眉山': `${GITHUB_BASE}/四川/峨眉山.jpg`,
  '乐山大佛': `${GITHUB_BASE}/四川/乐山大佛.jpg`,
  '都江堰': `${GITHUB_BASE}/四川/都江堰.jpg`,
  '青城山': `${GITHUB_BASE}/四川/青城山.jpg`,
  '稻城亚丁': `${GITHUB_BASE}/四川/稻城亚丁.jpg`,

  // 贵州
  '黄果树瀑布': `${GITHUB_BASE}/贵州/黄果树瀑布.jpg`,
  '荔波小七孔': `${GITHUB_BASE}/贵州/荔波小七孔.jpg`,
  '梵净山': `${GITHUB_BASE}/贵州/梵净山.jpg`,
  '西江千户苗寨': `${GITHUB_BASE}/贵州/西江千户苗寨.jpg`,

  // 云南
  '丽江古城': `${GITHUB_BASE}/云南/丽江古城.jpg`,
  '玉龙雪山': `${GITHUB_BASE}/云南/玉龙雪山.jpg`,
  '石林': `${GITHUB_BASE}/云南/石林.jpg`,
  '大理古城': `${GITHUB_BASE}/云南/大理古城.jpg`,
  '西双版纳': `${GITHUB_BASE}/云南/西双版纳.jpg`,
  '泸沽湖': `${GITHUB_BASE}/云南/泸沽湖.jpg`,

  // 西藏
  '布达拉宫': `${GITHUB_BASE}/西藏/布达拉宫.jpg`,
  '纳木错': `${GITHUB_BASE}/西藏/纳木错.jpg`,
  '大昭寺': `${GITHUB_BASE}/西藏/大昭寺.jpg`,
  '珠穆朗玛峰': `${GITHUB_BASE}/西藏/珠穆朗玛峰.jpg`,

  // 陕西
  '兵马俑': `${GITHUB_BASE}/陕西/兵马俑.jpg`,
  '华山': `${GITHUB_BASE}/陕西/华山.jpg`,
  '西安城墙': `${GITHUB_BASE}/陕西/西安城墙.jpg`,
  '大雁塔': `${GITHUB_BASE}/陕西/大雁塔.jpg`,
  '华清宫': `${GITHUB_BASE}/陕西/华清宫.jpg`,

  // 甘肃
  '莫高窟': `${GITHUB_BASE}/甘肃/莫高窟.jpg`,
  '月牙泉': `${GITHUB_BASE}/甘肃/月牙泉.jpg`,
  '嘉峪关': `${GITHUB_BASE}/甘肃/嘉峪关.jpg`,
  '张掖丹霞': `${GITHUB_BASE}/甘肃/张掖丹霞.jpg`,

  // 青海
  '青海湖': `${GITHUB_BASE}/青海/青海湖.jpg`,
  '塔尔寺': `${GITHUB_BASE}/青海/塔尔寺.jpg`,
  '茶卡盐湖': `${GITHUB_BASE}/青海/茶卡盐湖.jpg`,
  '可可西里': `${GITHUB_BASE}/青海/可可西里.jpg`,

  // 宁夏
  '沙坡头': `${GITHUB_BASE}/宁夏/沙坡头.jpg`,
  '西夏王陵': `${GITHUB_BASE}/宁夏/西夏王陵.jpg`,
  '镇北堡西部影城': `${GITHUB_BASE}/宁夏/镇北堡西部影城.jpg`,

  // 新疆
  '天山天池': `${GITHUB_BASE}/新疆/天山天池.jpg`,
  '喀纳斯湖': `${GITHUB_BASE}/新疆/喀纳斯湖.jpg`,
  '那拉提草原': `${GITHUB_BASE}/新疆/那拉提草原.jpg`,
  '吐鲁番葡萄沟': `${GITHUB_BASE}/新疆/吐鲁番葡萄沟.jpg`,
  '赛里木湖': `${GITHUB_BASE}/新疆/赛里木湖.jpg`,

  // 台湾
  '日月潭': `${GITHUB_BASE}/台湾/日月潭.jpg`,
  '阿里山': `${GITHUB_BASE}/台湾/阿里山.jpg`,
  '台北101': `${GITHUB_BASE}/台湾/台北101.jpg`,
  '太鲁阁': `${GITHUB_BASE}/台湾/太鲁阁.jpg`,

  // 香港
  '维多利亚港': `${GITHUB_BASE}/香港/维多利亚港.jpg`,
  '太平山顶': `${GITHUB_BASE}/香港/太平山顶.jpg`,
  '香港迪士尼乐园': `${GITHUB_BASE}/香港/香港迪士尼乐园.jpg`,
  '海洋公园': `${GITHUB_BASE}/香港/海洋公园.jpg`,

  // 澳门
  '大三巴牌坊': `${GITHUB_BASE}/澳门/大三巴牌坊.jpg`,
  '威尼斯人度假村': `${GITHUB_BASE}/澳门/威尼斯人度假村.jpg`,
  '妈阁庙': `${GITHUB_BASE}/澳门/妈阁庙.jpg`,
}

// 默认图片（当景点没有对应图片时使用）
export const DEFAULT_LANDMARK_IMAGE = `${GITHUB_BASE}/default.jpg`

// 获取景点图片
export function getLandmarkImage(landmarkName) {
  return LANDMARK_IMAGES[landmarkName] || DEFAULT_LANDMARK_IMAGE
}

// 按类别获取景点图片（用于展示）
export const CATEGORY_SHOWCASE_IMAGES = {
  '历史古迹': [
    { name: '故宫博物院', image: `${GITHUB_BASE}/北京/故宫.jpg` },
    { name: '长城', image: `${GITHUB_BASE}/北京/八达岭.jpg` },
    { name: '兵马俑', image: `${GITHUB_BASE}/陕西/兵马俑.jpg` },
  ],
  '自然风光': [
    { name: '黄山', image: `${GITHUB_BASE}/安徽/黄山.jpg` },
    { name: '张家界', image: `${GITHUB_BASE}/湖南/张家界.jpg` },
    { name: '九寨沟', image: `${GITHUB_BASE}/四川/九寨沟.jpg` },
  ],
  '现代建筑': [
    { name: '东方明珠', image: `${GITHUB_BASE}/上海/东方明珠.jpg` },
    { name: '台北101', image: `${GITHUB_BASE}/台湾/台北101.jpg` },
    { name: '广州塔', image: `${GITHUB_BASE}/广东/广州塔.jpg` },
  ],
  '宗教圣地': [
    { name: '布达拉宫', image: `${GITHUB_BASE}/西藏/布达拉宫.jpg` },
    { name: '武当山', image: `${GITHUB_BASE}/湖北/武当山.jpg` },
    { name: '五台山', image: `${GITHUB_BASE}/山西/五台山.jpg` },
  ],
}
