import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { ArrowLeft, RotateCcw, RotateCw } from 'lucide-react'
import JournalImage from './JournalImage'
import { imageFilter, isWestLake, SPOTS } from './model'

const project = (lng, lat) => [(lng - 120.1345) * Math.PI / 180 * 50000, -(Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) - Math.log(Math.tan(Math.PI / 4 + 30.2445 * Math.PI / 360))) * 50000]
export default function WestLakeScene({ entries, onClose, onOpen, onNew: openNew }) {
  const viewport = useRef(null), canvas = useRef(null), controller = useRef(null)
  const [pins, setPins] = useState([]), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const onNew = () => openNew({ trip_id: entries[0]?.trip_id, place_name: '西湖' })
  const photos = useMemo(() => entries.filter(isWestLake).flatMap(entry => entry.photos.map(photo => ({ ...photo, entry }))), [entries])
  const locations = useMemo(() => {
    const groups = new Map()
    photos.forEach((photo, index) => {
      const spot = SPOTS.find(item => item.key === photo.entry.spot_key)
      const lat = spot?.lat ?? photo.entry.lat, lng = spot?.lng ?? photo.entry.lng
      if (lat == null || lng == null || lat < 30.207 || lat > 30.282 || lng < 120.095 || lng > 120.174) return
      const key = `${lat.toFixed(5)},${lng.toFixed(5)}`
      if (!groups.has(key)) groups.set(key, { key, lat, lng, photo, numbers: [] })
      groups.get(key).numbers.push(index + 1)
    })
    return [...groups.values()]
  }, [photos])
  useEffect(() => {
    const abort = new AbortController()
    let renderer, controls, observer, scene, camera, disposed = false
    async function initialize() {
      try {
        const response = await fetch('/scenes/westlake.json', { signal: abort.signal })
        if (!response.ok) throw new Error('西湖的地形数据暂时无法加载。')
        const data = await response.json()
        if (disposed) return
        renderer = new THREE.WebGLRenderer({ canvas: canvas.current, antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.outputEncoding = THREE.sRGBEncoding
        renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05
        scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(36, 1, .1, 600)
        camera.position.set(-24, 53, 60)
        const css = getComputedStyle(viewport.current)
        const theme = name => new THREE.Color(css.getPropertyValue(name).trim()).convertSRGBToLinear()
        const land = theme('--scene-land'), forest = theme('--scene-forest'), water = theme('--scene-water'), edge = theme('--scene-edge')
        scene.add(new THREE.HemisphereLight(0xffffff, 0x64705c, .8))
        const sun = new THREE.DirectionalLight(0xffffff, .9); sun.position.set(-35, 70, 40); scene.add(sun)
        const terrain = data.terrain, n = terrain.size, [west, south, east, north] = terrain.bounds
        function heightAt(lng, lat) {
          const gx = Math.max(0, Math.min(n - 1, (lng - west) / (east - west) * (n - 1))), gy = Math.max(0, Math.min(n - 1, (north - lat) / (north - south) * (n - 1)))
          const x = Math.floor(gx), y = Math.floor(gy), x2 = Math.min(n - 1, x + 1), y2 = Math.min(n - 1, y + 1), fx = gx - x, fy = gy - y
          return Math.max(0, (terrain.heights[y * n + x] * (1 - fx) + terrain.heights[y * n + x2] * fx) * (1 - fy) + (terrain.heights[y2 * n + x] * (1 - fx) + terrain.heights[y2 * n + x2] * fx) * fy) * (50000 / 6371000) * 2.2
        }
        const draw = [120.113, 30.226, 120.162, 30.266]
        const geometry = new THREE.PlaneGeometry(1, 1, n - 1, n - 1), vertices = geometry.attributes.position, colors = []
        for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
          const lng = draw[0] + col / (n - 1) * (draw[2] - draw[0]), lat = draw[3] - row / (n - 1) * (draw[3] - draw[1]), [x, z] = project(lng, lat), height = heightAt(lng, lat)
          vertices.setXYZ(row * n + col, x, height, z)
          const color = land.clone().lerp(forest, Math.min(.9, Math.max(0, height / 3.8))); colors.push(color.r, color.g, color.b)
        }
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals()
        scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, side: THREE.DoubleSide })))
        const [x1, z1] = project(draw[0], draw[3]), [x2, z2] = project(draw[2], draw[1])
        const base = new THREE.Mesh(new THREE.BoxGeometry(x2 - x1, 1.5, z2 - z1), new THREE.MeshStandardMaterial({ color: edge, roughness: 1 })); base.position.set((x1 + x2) / 2, -.8, (z1 + z2) / 2); scene.add(base)
        function shapeFrom(rings) {
          const shape = new THREE.Shape()
          rings[0].forEach(([lng, lat], index) => { const [x, z] = project(lng, lat); if (index) shape.lineTo(x, -z); else shape.moveTo(x, -z) })
          for (const ring of rings.slice(1)) { const hole = new THREE.Path(); ring.forEach(([lng, lat], index) => { const [x, z] = project(lng, lat); if (index) hole.lineTo(x, -z); else hole.moveTo(x, -z) }); shape.holes.push(hole) }
          return shape
        }
        for (const polygon of data.lake.geometry.coordinates) {
          const lake = new THREE.ShapeGeometry(shapeFrom(polygon)); lake.rotateX(-Math.PI / 2)
          const mesh = new THREE.Mesh(lake, new THREE.MeshStandardMaterial({ color: water, roughness: .3, metalness: .12, side: THREE.DoubleSide })); mesh.position.y = .24; scene.add(mesh)
        }
        const tower = new THREE.Group(), [tx, tz] = project(120.1487, 30.2301); tower.position.set(tx, heightAt(120.1487, 30.2301), tz)
        for (let i = 0; i < 5; i++) {
          const body = new THREE.Mesh(new THREE.CylinderGeometry(.52 - i * .055, .58 - i * .055, .55, 8), new THREE.MeshStandardMaterial({ color: theme('--scene-tower') })); body.position.y = .4 + i * .7; tower.add(body)
          const roof = new THREE.Mesh(new THREE.ConeGeometry(.85 - i * .07, .35, 8), new THREE.MeshStandardMaterial({ color: forest })); roof.position.y = .8 + i * .7; tower.add(roof)
        }
        scene.add(tower)
        for (const location of locations) {
          const [x, z] = project(location.lng, location.lat), pin = new THREE.Mesh(new THREE.SphereGeometry(.4, 12, 8), new THREE.MeshStandardMaterial({ color: theme('--scene-pin') })); pin.position.set(x, Math.max(.5, heightAt(location.lng, location.lat)) + .6, z); scene.add(pin)
        }
        controls = new OrbitControls(camera, canvas.current); controls.target.set(0, 1, 0)
        controls.enablePan = false; controls.enableDamping = false; controls.minDistance = 48; controls.maxDistance = 120; controls.minPolarAngle = .08; controls.maxPolarAngle = Math.PI / 2 - .12
        function render() {
          if (disposed) return
          camera.updateMatrixWorld(); renderer.render(scene, camera)
          const width = viewport.current.clientWidth, height = viewport.current.clientHeight
          setPins(locations.map(location => { const [x, z] = project(location.lng, location.lat), projected = new THREE.Vector3(x, Math.max(.5, heightAt(location.lng, location.lat)) + 1.1, z).project(camera); return { ...location, x: (projected.x + 1) / 2 * width, y: (1 - projected.y) / 2 * height, visible: projected.z < 1 && Math.abs(projected.x) < .95 && Math.abs(projected.y) < .95 } }))
        }
        controls.addEventListener('change', render); controls.update()
        observer = new ResizeObserver(() => { const { clientWidth: width, clientHeight: height } = viewport.current; if (!width || !height) return; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); render() }); observer.observe(viewport.current)
        controller.current = { rotate(direction) { const offset = camera.position.clone().sub(controls.target); offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), direction * .25); camera.position.copy(controls.target).add(offset); controls.update(); render() }, top() { const distance = camera.position.distanceTo(controls.target); camera.position.set(0, distance, .5); controls.update(); render() } }
        setLoading(false)
      } catch (error) { if (!disposed && error.name !== 'AbortError') { setError(error.message.includes('WebGL') ? '当前设备暂不支持三维场景，可以返回画布继续看照片。' : error.message); setLoading(false) } }
    }
    initialize()
    return () => { disposed = true; abort.abort(); observer?.disconnect(); controls?.dispose(); controller.current = null; scene?.traverse(object => { object.geometry?.dispose(); if (Array.isArray(object.material)) object.material.forEach(material => material.dispose()); else object.material?.dispose() }); renderer?.dispose(); renderer?.forceContextLoss() }
  }, [locations])
  return <main className="j-scene">
    <header className="j-scene-header"><button className="j-button" onClick={onClose}><ArrowLeft />回到画布</button><div><span>杭州 / 西湖</span><h1>把这片湖，转过来看。</h1></div><span className="j-scene-help">拖动旋转 · 滚轮缩放</span></header>
    <div className="j-scene-body"><div className="j-scene-viewport" ref={viewport}>
      <canvas ref={canvas} aria-label="根据西湖实际湖岸与高程生成的可旋转三维地形" />
      {pins.filter(pin => pin.visible).map(pin => <button key={pin.key} className="j-scene-pin" style={{ left: pin.x, top: pin.y }} aria-label={`查看第${pin.numbers.join('、')}张照片的位置`} onClick={() => onOpen(pin.photo.entry, pin.photo.id)}>{pin.numbers[0]}{pin.numbers.length > 1 ? `＋${pin.numbers.length - 1}` : ''}</button>)}
      {loading && <div className="j-scene-message" role="status">正在展开西湖的山水…</div>}{error && <div className="j-scene-message j-error" role="alert">{error}</div>}
      <div className="j-orbit-controls"><button className="j-icon-button" aria-label="向左旋转" onClick={() => controller.current?.rotate(-1)}><RotateCcw /></button><button className="j-button" onClick={() => controller.current?.top()}>俯视</button><button className="j-icon-button" aria-label="向右旋转" onClick={() => controller.current?.rotate(1)}><RotateCw /></button></div>
      <small className="j-scene-attribution">© OpenStreetMap 湖岸 · Mapzen 高程 / 建筑造型示意</small>
    </div><aside className="j-scene-dock" aria-label="西湖的照片"><div className="j-scene-dock-title">留在这里的片刻 <small>{photos.length} 张</small></div>{photos.map((photo, index) => <button key={photo.id} className="j-scene-photo" onClick={() => onOpen(photo.entry, photo.id)}><JournalImage src={photo.url} alt={photo.entry.place_name || '西湖照片'} style={{ objectPosition: `${photo.crop_x}% 50%`, filter: imageFilter(photo.image_filter) }} /><span><b>{index + 1}</b>{photo.entry.title || photo.entry.caption || '湖边的一刻'}</span><small>{SPOTS.find(spot => spot.key === photo.entry.spot_key)?.name || '具体位置待补充'} · {photo.entry.entry_date.slice(5).replace('-', '.')}</small></button>)}{!photos.length && <p>这里还没有照片。先留下一刻，再慢慢关联位置。</p>}<button className="j-button" onClick={onNew}>添加西湖记忆</button></aside></div>
  </main>
}
