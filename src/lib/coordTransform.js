/**
 * WGS-84 ↔ GCJ-02 坐标转换
 *
 * 高德地图瓦片使用 GCJ-02（国测局坐标）。
 * 数据库中的经纬度（景点、打卡、足迹）存的是 WGS-84，渲染到高德瓦片前需转换为 GCJ-02。
 *
 * 注意：DataV 边界数据（geo.datav.aliyun.com/areas_v3）本身已是 GCJ-02，与高德瓦片同坐标系，
 * 直接叠加即可对齐，严禁再做 wgs84→gcj02 转换（会导致双重加密、边界偏移约 600 米）。
 */

const PI = Math.PI
const A = 6378245.0 // 长半轴
const EE = 0.00669342162296594 // 偏心率平方

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x, y) {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3
  ret += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3
  ret += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3
  return ret
}

function transformLng(x, y) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3
  ret += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3
  ret += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3
  return ret
}

/**
 * WGS-84 经纬度 → GCJ-02 经纬度
 * @param {number} wgsLng - WGS-84 经度
 * @param {number} wgsLat - WGS-84 纬度
 * @returns {[number, number]} [gcjLng, gcjLat]
 */
export function wgs84ToGcj02(wgsLng, wgsLat) {
  if (outOfChina(wgsLng, wgsLat)) return [wgsLng, wgsLat]

  let dLat = transformLat(wgsLng - 105, wgsLat - 35)
  let dLng = transformLng(wgsLng - 105, wgsLat - 35)
  const radLat = wgsLat / 180 * PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI)
  dLng = (dLng * 180) / (A / sqrtMagic * Math.cos(radLat) * PI)
  return [wgsLng + dLng, wgsLat + dLat]
}

/**
 * GCJ-02 经纬度 → WGS-84 经纬度（逆向转换）
 * @param {number} gcjLng - GCJ-02 经度
 * @param {number} gcjLat - GCJ-02 纬度
 * @returns {[number, number]} [wgsLng, wgsLat]
 */
export function gcj02ToWgs84(gcjLng, gcjLat) {
  if (outOfChina(gcjLng, gcjLat)) return [gcjLng, gcjLat]

  // Use iterative refinement for accuracy
  let wgsLng = gcjLng
  let wgsLat = gcjLat
  for (let i = 0; i < 5; i++) {
    const [tmpLng, tmpLat] = wgs84ToGcj02(wgsLng, wgsLat)
    wgsLng += gcjLng - tmpLng
    wgsLat += gcjLat - tmpLat
  }
  return [wgsLng, wgsLat]
}
