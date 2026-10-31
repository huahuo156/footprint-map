import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Check, ChevronDown, ChevronUp, Copy, GripVertical, Heart, ImagePlus, LocateFixed, MapPin, Plus, Route, Text, Type, X } from 'lucide-react'
import { fetchLandmarks } from '../lib/api'
import { exifComponents, readPhotoExif } from '../lib/exif'
import Modal from './Modal'
import JournalImage from './JournalImage'
import PlaceSearch from './PlaceSearch'
import { imageFilter, localDate, PALETTES, SPOTS } from './model'
import { COMPONENT_LABELS, COMPONENT_TYPES, hasComponentContent, legacyComponents, photoComponents } from './components'

const icons = { date: CalendarDays, place: MapPin, trip: Route, description: Text, mood: Heart, title: Type }
const blankTrip = () => ({ name: '', region: '', color: 'sage' })
function fresh(type) { return { type, value: type === 'date' ? localDate() : type === 'place' ? { name: '', lat: null, lng: null, landmark_id: null, spot_key: '' } : null } }

export default function EntryEditor({ entry, preset, initialPhotoId, trips, onClose, onSave, onCreateTrip, embedded = false, onBusyChange, batchCount = 0 }) {
  const initial = () => entry ? structuredClone(entry.components ?? legacyComponents(entry)) : [preset?.place_name ? { type: 'place', value: { name: preset.place_name } } : null, preset?.trip_id ? { type: 'trip', value: preset.trip_id } : null].filter(Boolean)
  const [notes, setNotes] = useState(initial)
  const [photos, setPhotos] = useState(() => (entry?.photos || []).map(photo => ({ ...photo, preview: photo.url, key: photo.id, components: photoComponents(photo, entry) })))
  const [selected, setSelected] = useState(Math.max(0, entry?.photos?.findIndex(photo => photo.id === initialPhotoId) ?? 0))
  const [landmarks, setLandmarks] = useState([]), [busy, setBusy] = useState(false), [locating, setLocating] = useState(false), [error, setError] = useState(''), [focusType, setFocusType] = useState(null), [hint, setHint] = useState('')
  const [readingExif, setReadingExif] = useState(0)
  const previews = useRef([]), fileInput = useRef(null), blocks = useRef(new Map()), mounted = useRef(true), createdTrips = useRef(new Map()), exifLandmarks = useRef(null)
  const active = photos[selected], parts = active?.components || notes, targetKey = active?.key || '__note__'
  const batchSize = photos.filter(photo => photo.file).length
  useEffect(() => { onBusyChange?.(busy || readingExif > 0) }, [busy, readingExif, onBusyChange])
  useEffect(() => { const blobs = previews.current; mounted.current = true; return () => { mounted.current = false; blobs.forEach(url => URL.revokeObjectURL(url)) } }, [])
  const needsPlaces = parts.some(part => part.type === 'place')
  useEffect(() => {
    if (!needsPlaces) return
    let current = true
    fetchLandmarks().then(rows => { if (current) setLandmarks(rows) }).catch(() => {})
    return () => { current = false }
  }, [needsPlaces])
  useEffect(() => { if (focusType) { blocks.current.get(focusType)?.querySelector('input,textarea,select')?.focus(); setFocusType(null) } }, [focusType])
  function updateFor(key, updater, editedType) {
    if (key === '__note__') setNotes(updater)
    else setPhotos(previous => {
      const source = previous.find(photo => photo.key === key)
      if (!source) return previous
      return previous.map(photo => photo.key === key || (source.file && photo.file) ? {
        ...photo, components: updater(photo.components),
        exifTypes: (photo.exifTypes || []).filter(type => type !== editedType),
        touchedTypes: editedType ? [...new Set([...(photo.touchedTypes || []), editedType])] : photo.touchedTypes,
      } : photo)
    })
  }
  function update(type, value, extra = {}) { updateFor(targetKey, list => list.some(part => part.type === type) ? list.map(part => part.type === type ? { ...part, value, ...extra } : part) : [...list, { type, value, ...extra }], type) }
  function add(type) { updateFor(targetKey, list => list.some(part => part.type === type) ? list : [...list, fresh(type)], type); setFocusType(type); setHint('') }
  function remove(type) { updateFor(targetKey, list => list.filter(part => part.type !== type), type); setHint('') }
  function reorder(type, destination) { updateFor(targetKey, list => { const from = list.findIndex(part => part.type === type), to = Math.max(0, Math.min(list.length - 1, destination)); if (from < 0 || from === to) return list; const next = [...list], [part] = next.splice(from, 1); next.splice(to, 0, part); return next }) }
  function addFiles(files) {
    if (photos.length + files.length > 20) { setError('一次最多留下 20 张照片。'); return }
    if (files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)) { setError('请选择 10MB 以内的 JPG、PNG 或 WebP 照片。'); return }
    const template = photos.find(photo => photo.file)
    const components = template ? template.components.filter(part => !template.exifTypes?.includes(part.type)) : parts
    const added = files.map(file => { const preview = URL.createObjectURL(file); previews.current.push(preview); return { key: crypto.randomUUID(), file, preview, crop_x: 50, image_filter: 'original', components: structuredClone(components) } })
    setSelected(photos.length); setPhotos(previous => [...previous, ...added]); setError('')
    setReadingExif(count => count + 1)
    autoFillExif(added).catch(() => {}).finally(() => { if (mounted.current) setReadingExif(count => count - 1) })
  }
  // 从 EXIF 预填拍摄日期和坐标；只补缺失的组件，用户已写的内容不动。
  async function autoFillExif(added) {
    const found = []
    for (const photo of added) {
      const exif = await readPhotoExif(photo.file).catch(() => null)
      if (!mounted.current) return
      if (exif?.date || exif?.lat != null) found.push([photo.key, exif])
    }
    if (!found.length) return
    if (found.some(([, exif]) => exif.lat != null) && !exifLandmarks.current) exifLandmarks.current = await fetchLandmarks().catch(() => [])
    if (!mounted.current) return
    setPhotos(previous => previous.map(photo => {
      const hit = found.find(([key]) => key === photo.key)
      if (!hit) return photo
      const additions = exifComponents(hit[1], exifLandmarks.current || []).filter(extra => !photo.components.some(part => part.type === extra.type) && !photo.touchedTypes?.includes(extra.type))
      return additions.length ? { ...photo, components: [...photo.components, ...additions], exifTypes: additions.map(part => part.type) } : photo
    }))
  }
  function dropPhoto(index) { if (photos.length === 1) setNotes(structuredClone(photos[0].components)); setPhotos(previous => previous.filter((_, i) => i !== index)); setSelected(0) }
  function changePhoto(field, value) { setPhotos(previous => previous.map((photo, index) => index === selected ? { ...photo, [field]: value } : photo)) }
  function locate() {
    if (!navigator.geolocation) { setError('当前浏览器不支持定位，也可以直接写个地点。'); return }
    const key = targetKey
    setLocating(true); setError('')
    navigator.geolocation.getCurrentPosition(position => { if (!mounted.current) return; updateFor(key, list => list.map(part => part.type === 'place' ? { ...part, value: { ...part.value, lat: position.coords.latitude, lng: position.coords.longitude, spot_key: '' } } : part)); setLocating(false) }, () => { if (mounted.current) { setError('没有取得位置，也可以直接写个地点。'); setLocating(false) } }, { timeout: 10000, enableHighAccuracy: false })
  }
  function copyComponents() {
    setPhotos(previous => previous.map(photo => photo.key === active.key ? photo : { ...photo, components: [...photo.components, ...structuredClone(parts.filter(part => !photo.components.some(existing => existing.type === part.type)))] }))
    setHint('已给其他照片补上这些组件，原有内容保留。')
  }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (batchCount ? !notes.length : !photos.length && !notes.some(hasComponentContent)) throw new Error('请添加一点想留下的内容。')
      const created = createdTrips.current
      async function prepare(list) {
        const result = []
        for (const part of list) {
          if (part.type === 'trip' && part.value === '__new__') {
            const draft = part.draft || blankTrip(), key = JSON.stringify(draft)
            if (!created.has(key)) created.set(key, (await onCreateTrip(draft)).id)
            result.push({ type: 'trip', value: created.get(key) })
          } else result.push({ type: part.type, value: part.value })
        }
        return result
      }
      const prepared = []
      for (const photo of photos) prepared.push(await prepare(photo.components))
      const noteParts = photos.length ? [] : await prepare(notes)
      if (batchCount) { await onSave(noteParts); onClose(); return }
      if (created.size) {
        const resolve = list => list.map(part => part.type === 'trip' && part.value === '__new__' && created.has(JSON.stringify(part.draft || blankTrip())) ? { type: 'trip', value: created.get(JSON.stringify(part.draft || blankTrip())) } : part)
        setPhotos(previous => previous.map(photo => ({ ...photo, components: resolve(photo.components) }))); setNotes(resolve)
      }
      const body = new FormData(), list = []
      let uploadIndex = 0
      photos.forEach((photo, index) => {
        const metadata = { crop_x: photo.crop_x, image_filter: photo.image_filter, components: prepared[index] }
        if (photo.file) { body.append('images', photo.file); list.push({ ...metadata, upload_index: uploadIndex++ }) } else list.push({ ...metadata, id: photo.id })
      })
      body.append('data', JSON.stringify({ entry_date: entry?.captured_on || entry?.entry_date || localDate(), trip_id: null, components: noteParts, photos: list }))
      await onSave(entry?.id, body); onClose()
    } catch (error) { setError(error.message); setBusy(false) }
  }
  function renderPart(part) {
    const value = part.value
    if (part.type === 'date') return <label><span className="j-visually-hidden">发生在</span><input type="date" min="1900-01-01" value={value || ''} onChange={event => update('date', event.target.value || null)} /></label>
    if (part.type === 'description') return <label><span className="j-visually-hidden">想记住的事情</span><textarea rows={3} maxLength={10000} placeholder="写点什么……半句话也好。" value={value || ''} onChange={event => update('description', event.target.value)} /></label>
    if (part.type === 'title') return <label><span className="j-visually-hidden">手帐标题</span><input maxLength={160} placeholder="起个小标题" value={value || ''} onChange={event => update('title', event.target.value)} /></label>
    if (part.type === 'mood') return <div className="j-mood"><div>{['平静', '开心', '惊喜'].map((mood, index) => <button type="button" key={mood} aria-pressed={value === mood} onClick={() => update('mood', value === mood ? null : mood)}>{['☁', '☀', '✦'][index]} {mood}</button>)}</div></div>
    if (part.type === 'place') return <><div className="j-component-place"><PlaceSearch key={targetKey} value={value} landmarks={landmarks} onChange={place => update('place', place)} /><button type="button" className="j-icon-button" aria-label="使用当前位置" disabled={locating} onClick={locate}><LocateFixed /></button></div>{/西湖/.test(value?.name || '') && <label className="j-spot-picker">西湖里的具体位置<select value={value?.spot_key || ''} onChange={event => { const spot = SPOTS.find(item => item.key === event.target.value); update('place', { ...value, spot_key: spot?.key || '', lat: spot?.lat ?? null, lng: spot?.lng ?? null }) }}><option value="">以后再补具体位置</option>{SPOTS.map(spot => <option key={spot.key} value={spot.key}>{spot.name}</option>)}</select></label>}{value?.lat != null && <small className="j-coordinate-saved">已关联位置</small>}</>
    if (part.type === 'trip') {
      const draft = part.draft || blankTrip()
      return <><label><span className="j-visually-hidden">放进哪段旅程</span><select value={value || ''} onChange={event => update('trip', event.target.value || null)}><option value="">先不选旅程</option>{trips.map(trip => <option value={trip.id} key={trip.id}>{trip.name}</option>)}<option value="__new__">＋ 新的旅程</option></select></label>{value === '__new__' && <div className="j-new-trip"><label>旅程名称<input required maxLength={120} placeholder="比如：江南的五月" value={draft.name} onChange={event => update('trip', '__new__', { draft: { ...draft, name: event.target.value } })} /></label><details><summary>地区和颜色</summary><label>这一段去了哪里<input maxLength={120} placeholder="杭州 / 乌镇 / 上海" value={draft.region} onChange={event => update('trip', '__new__', { draft: { ...draft, region: event.target.value } })} /></label><div className="j-color-options" aria-label="旅程颜色">{PALETTES.map((color, index) => <button type="button" key={color} data-color={color} aria-pressed={draft.color === color} aria-label={['鼠尾草绿', '浅沙色', '晴空蓝', '淡玫瑰', '浅紫色'][index]} onClick={() => update('trip', '__new__', { draft: { ...draft, color } })} />)}</div></details></div>}</>
    }
  }
  const content = <form onSubmit={submit} onPaste={event => { if (batchCount) return; const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/')); if (files.length) { event.preventDefault(); addFiles(files) } }}><fieldset disabled={busy}>
      <div className={'j-editor-grid ' + (batchCount ? 'is-metadata-only' : '')}>{!batchCount && <section className="j-photo-editor" aria-label="照片" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); addFiles([...event.dataTransfer.files]) } }}>
        <div className="j-editor-preview">{active ? <JournalImage src={active.preview} alt="当前照片" loading="eager" style={{ objectPosition: `${active.crop_x}% 50%`, filter: imageFilter(active.image_filter) }} /> : <button type="button" onClick={() => fileInput.current.click()}><ImagePlus /><span>放一张照片在这里</span><small>拖入、粘贴，或点击选择</small></button>}</div>
        <input ref={fileInput} className="j-visually-hidden" aria-label="选择旅行照片" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => { addFiles([...event.target.files]); event.target.value = '' }} />
        <button className="j-button j-add-images" type="button" onClick={() => fileInput.current.click()}><Plus />{photos.length ? '再放几张照片' : '添加照片'}</button>
        {photos.length > 0 && <><div className="j-editor-thumbnails">{photos.map((photo, index) => <div key={photo.key} className={index === selected ? 'is-selected' : ''}><button className="j-thumbnail" type="button" aria-label={`选择第 ${index + 1} 张照片`} aria-pressed={index === selected} onClick={() => { setSelected(index); setHint('') }}><JournalImage src={photo.preview} alt="" /></button><button className="j-remove-photo" type="button" aria-label={`移除第 ${index + 1} 张照片`} onClick={() => dropPhoto(index)}><X /></button></div>)}</div><details className="j-photo-adjust"><summary>调整照片</summary><div className="j-editor-filters"><span>照片的氛围</span><div>{[['original', '原图'], ['film', '胶片'], ['mono', '黑白']].map(([filter, label]) => <button key={filter} type="button" aria-pressed={active?.image_filter === filter} onClick={() => changePhoto('image_filter', filter)}>{label}</button>)}</div></div><label className="j-focus-control">画面焦点<input type="range" min="0" max="100" value={active?.crop_x ?? 50} onChange={event => changePhoto('crop_x', Number(event.target.value))} /></label></details></>}
      </section>}<section className="j-memory-fields j-component-composition" aria-label="自由组合内容">
        <div className="j-composer-intro"><span>{batchCount ? `一起编辑 ${batchCount} 张照片` : active?.file && batchSize > 1 ? `给这 ${batchSize} 张照片添点内容` : active ? `给第 ${selected + 1} 张照片添点内容` : '想留下什么？'}</span><p>{batchCount ? '只同步下面添加的项目，其他内容保留。项目留空会移除对应信息。' : active?.file && batchSize > 1 ? '内容和组件顺序会自动同步到本次上传的照片。' : parts.length ? '顺序随你，也可以随时拿掉。' : '只留照片也好，想加什么，再加什么。'}</p></div>
        <div className="j-component-blocks">{parts.map((part, index) => { const Icon = icons[part.type]; return <section key={part.type} data-block={part.type} className="j-component-block" ref={element => { if (element) blocks.current.set(part.type, element); else blocks.current.delete(part.type) }} onDragOver={event => { if (event.dataTransfer.types.includes('text/x-journal-component')) event.preventDefault() }} onDrop={event => { const type = event.dataTransfer.getData('text/x-journal-component'); if (type) { event.preventDefault(); reorder(type, index) } }}>
          <header><button type="button" className="j-component-grip" draggable aria-label={`拖动${COMPONENT_LABELS[part.type]}调整顺序`} onDragStart={event => event.dataTransfer.setData('text/x-journal-component', part.type)}><GripVertical /></button><Icon /><span>{COMPONENT_LABELS[part.type]}</span><div><button type="button" className="j-icon-button" aria-label={`${COMPONENT_LABELS[part.type]}上移`} disabled={!index} onClick={() => reorder(part.type, index - 1)}><ChevronUp /></button><button type="button" className="j-icon-button" aria-label={`${COMPONENT_LABELS[part.type]}下移`} disabled={index === parts.length - 1} onClick={() => reorder(part.type, index + 1)}><ChevronDown /></button><button type="button" className="j-icon-button" aria-label={`移除${COMPONENT_LABELS[part.type]}`} onClick={() => remove(part.type)}><X /></button></div></header>{renderPart(part)}
        </section> })}</div>
        <div className="j-component-picker" aria-label="添加内容组件"><span><Plus />添加内容</span><div>{COMPONENT_TYPES.map(type => { const Icon = icons[type], added = parts.some(part => part.type === type); return <button type="button" key={type} aria-label={`添加${COMPONENT_LABELS[type]}`} aria-pressed={added} disabled={added} onClick={() => add(type)}><Icon />{COMPONENT_LABELS[type]}{added && <Check />}</button> })}</div></div>
        {photos.length > 1 && !active?.file && parts.length > 0 && <button className="j-button j-copy-components" type="button" onClick={copyComponents}><Copy />也给其他照片加上</button>}
        {hint && <p className="j-composer-hint" role="status">{hint}</p>}
      </section></div>
      {error && <p className="j-error" role="alert">{error}</p>}
      <footer className="j-editor-footer"><span role="status">{readingExif ? '正在读取照片日期与位置…' : batchCount ? '只修改选中的照片。' : `${photos.length ? photos.length + ' 张照片，' : ''}先留下，以后再慢慢加。`}</span><div><button type="button" className="j-button" onClick={onClose}>取消</button><button className="j-button j-primary" type="submit" disabled={readingExif > 0 || (batchCount ? !notes.length : !photos.length && !notes.some(hasComponentContent))}><Check />{busy ? '正在保存…' : batchCount ? `同步到 ${batchCount} 张照片` : entry ? '保存修改' : '留下'}</button></div></footer>
    </fieldset></form>
  return embedded ? content : <Modal title={entry ? '给这一刻添点内容' : '留下一刻'} onClose={onClose} className="j-entry-editor j-composer" busy={busy}>{content}</Modal>
}
