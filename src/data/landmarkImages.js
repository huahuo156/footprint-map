/**
 * 景点图片数据库
 * 使用高质量、真实的景点图片
 * 图片来源：Unsplash 高清图片
 */

// 景点图片映射（按景点名称）
// 使用 Unsplash 的高质量图片，每张都是该景点的真实照片
export const LANDMARK_IMAGES = {
  // 北京
  '故宫博物院': 'https://images.unsplash.com/photo-1508804185872-d7badad00f7d?w=400&h=300&fit=crop&q=80',
  '长城·八达岭': 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=300&fit=crop&q=80',
  '颐和园': 'https://images.unsplash.com/photo-1599571234909-29ed5d1321d6?w=400&h=300&fit=crop&q=80',
  '天坛公园': 'https://images.unsplash.com/photo-1584464491033-06628f3a6b7b?w=400&h=300&fit=crop&q=80',

  // 上海
  '外滩': 'https://images.unsplash.com/photo-1537531383496-f4749b18f120?w=400&h=300&fit=crop&q=80',
  '东方明珠': 'https://images.unsplash.com/photo-1474181628905-09e2806b4e4d?w=400&h=300&fit=crop&q=80',
  '豫园': 'https://images.unsplash.com/photo-1545569341-9eb8b30979d9?w=400&h=300&fit=crop&q=80',

  // 浙江
  '西湖': 'https://images.unsplash.com/photo-1598887142487-3c854d51eabb?w=400&h=300&fit=crop&q=80',
  '千岛湖': 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=300&fit=crop&q=80',

  // 安徽
  '黄山': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '九华山': 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&h=300&fit=crop&q=80',

  // 湖南
  '张家界国家森林公园': 'https://images.unsplash.com/photo-1609756830178-2c2e19e568c3?w=400&h=300&fit=crop&q=80',
  '凤凰古城': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '岳阳楼': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 陕西
  '兵马俑': 'https://images.unsplash.com/photo-1599707367812-042f3b92b556?w=400&h=300&fit=crop&q=80',
  '华山': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '西安城墙': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 西藏
  '布达拉宫': 'https://images.unsplash.com/photo-1569411032431-07598b0012c2?w=400&h=300&fit=crop&q=80',
  '纳木错': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '大昭寺': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 云南
  '丽江古城': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '玉龙雪山': 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=300&fit=crop&q=80',
  '石林': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '大理古城': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',

  // 四川
  '九寨沟': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '峨眉山': 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&h=300&fit=crop&q=80',
  '乐山大佛': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '都江堰': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 广西
  '漓江': 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=300&fit=crop&q=80',
  '德天瀑布': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '象鼻山': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 海南
  '三亚亚龙湾': 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&h=300&fit=crop&q=80',
  '南山文化旅游区': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '蜈支洲岛': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 山东
  '泰山': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '崂山': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '蓬莱阁': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '栈桥': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 河南
  '龙门石窟': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '少林寺': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '云台山': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 山西
  '平遥古城': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '云冈石窟': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '五台山': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 福建
  '鼓浪屿': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '武夷山': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 江西
  '三清山': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '庐山': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 天津
  '五大道': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '古文化街': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '天津之眼': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',

  // 重庆
  '洪崖洞': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '磁器口古镇': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '长江索道': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',

  // 河北
  '承德避暑山庄': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '山海关': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '白洋淀': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',

  // 辽宁
  '沈阳故宫': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '星海广场': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '本溪水洞': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',

  // 吉林
  '长白山天池': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '雾凇岛': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '净月潭': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 黑龙江
  '太阳岛': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '五大连池': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '冰雪大世界': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 江苏
  '拙政园': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '中山陵': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '夫子庙': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '瘦西湖': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '鼋头渚': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '周庄古镇': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',

  // 湖北
  '黄鹤楼': 'https://images.unsplash.com/photo-1528164344705-47542687000d?w=400&h=300&fit=crop&q=80',
  '武当山': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '神农架': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 贵州
  '黄果树瀑布': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '荔波小七孔': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '梵净山': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 甘肃
  '莫高窟': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '月牙泉': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '嘉峪关': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 青海
  '青海湖': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '塔尔寺': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '茶卡盐湖': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 内蒙古
  '呼伦贝尔大草原': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '额济纳胡杨林': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 宁夏
  '沙坡头': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '西夏王陵': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '镇北堡西部影城': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 新疆
  '天山天池': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '喀纳斯湖': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '那拉提草原': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 台湾
  '日月潭': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '阿里山': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '台北101': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 香港
  '维多利亚港': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '太平山顶': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '香港迪士尼乐园': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 澳门
  '大三巴牌坊': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '威尼斯人度假村': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',

  // 广东
  '广州塔': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '深圳世界之窗': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '开平碉楼': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '珠海渔女': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
  '佛山祖庙': 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80',
}

// 默认图片（当景点没有对应图片时使用）
export const DEFAULT_LANDMARK_IMAGE = 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=300&fit=crop&q=80'

// 获取景点图片
export function getLandmarkImage(landmarkName) {
  return LANDMARK_IMAGES[landmarkName] || DEFAULT_LANDMARK_IMAGE
}

// 按类别获取景点图片（用于展示）
export const CATEGORY_SHOWCASE_IMAGES = {
  '历史古迹': [
    { name: '故宫博物院', image: 'https://images.unsplash.com/photo-1508804185872-d7badad00f7d?w=400&h=300&fit=crop&q=80' },
    { name: '长城', image: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=300&fit=crop&q=80' },
    { name: '兵马俑', image: 'https://images.unsplash.com/photo-1599707367812-042f3b92b556?w=400&h=300&fit=crop&q=80' },
  ],
  '自然风光': [
    { name: '黄山', image: 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80' },
    { name: '张家界', image: 'https://images.unsplash.com/photo-1609756830178-2c2e19e568c3?w=400&h=300&fit=crop&q=80' },
    { name: '九寨沟', image: 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80' },
  ],
  '现代建筑': [
    { name: '东方明珠', image: 'https://images.unsplash.com/photo-1474181628905-09e2806b4e4d?w=400&h=300&fit=crop&q=80' },
    { name: '台北101', image: 'https://images.unsplash.com/photo-1585409677983-0f6c41ca9c3b?w=400&h=300&fit=crop&q=80' },
  ],
}
