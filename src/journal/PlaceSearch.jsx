import { useEffect, useId, useState } from 'react'
import { searchPlaces } from '../lib/api'

export default function PlaceSearch({ value, landmarks, onChange }) {
  const id = useId()
  const [query, setQuery] = useState(null), [remote, setRemote] = useState([]), [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [warning, setWarning] = useState(''), [index, setIndex] = useState(-1)
  const local = query?.trim().length >= 2 ? landmarks.filter(place => place.name.includes(query.trim())).slice(0, 6).map(place => ({ ...place, local: true, address: [place.province, place.city].filter(Boolean).join(' · ') })) : []
  const options = [...remote, ...local.filter(place => !remote.some(hit => hit.name === place.name))].slice(0, 6)
  useEffect(() => {
    if (!query || query.trim().length < 2 || query.trim().length > 80) return
    const controller = new AbortController()
    let alive = true
    const timeout = setTimeout(() => {
      setLoading(true)
      searchPlaces(query.trim(), controller.signal).then(data => { if (alive) { setRemote(data.places); setWarning('') } }).catch(error => { if (alive && error.name !== 'AbortError') setWarning(error.message) }).finally(() => { if (alive) setLoading(false) })
    }, 350)
    return () => { alive = false; clearTimeout(timeout); controller.abort() }
  }, [query])
  function input(name) {
    const known = landmarks.find(place => place.name === name)
    setQuery(name); setRemote([]); setOpen(true); setWarning(name.trim().length > 80 ? '地点较长，可以缩短关键词搜索；仍可直接保存当前文字。' : ''); setLoading(false); setIndex(-1)
    onChange({ name, landmark_id: known?.id ?? null, lat: known?.lat ?? null, lng: known?.lng ?? null, spot_key: '' })
  }
  function select(place) {
    setOpen(false); setQuery(null); setRemote([]); setLoading(false); setWarning(''); setIndex(-1)
    onChange({ name: place.name, lat: place.lat, lng: place.lng, landmark_id: place.local ? place.id : null, spot_key: '', ...(!place.local ? { address: place.address, provider: 'amap', poi_id: place.id } : {}) })
  }
  return <div className="j-place-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <label><span className="j-visually-hidden">旅行地点</span><input role="combobox" aria-autocomplete="list" aria-controls={id} aria-expanded={open && options.length > 0} aria-activedescendant={open && index >= 0 ? `${id}-${index}` : undefined} autoComplete="off" maxLength={255} placeholder="输入地点，搜索具体地址" value={value?.name || ''} onChange={event => input(event.target.value)} onFocus={() => { if (query) setOpen(true) }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); return }
      if (!open || !options.length) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setIndex(previous => (previous + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length) }
      if (event.key === 'Enter') { event.preventDefault(); select(options[index >= 0 ? index : 0]) }
    }} /></label>
    {open && options.length > 0 && <div className="j-place-options" id={id} role="listbox" aria-label="地点搜索结果">{options.map((place, i) => <button type="button" role="option" aria-selected={index === i} id={`${id}-${i}`} key={`${place.local ? 'local' : 'amap'}-${place.id}`} onMouseDown={event => event.preventDefault()} onClick={() => select(place)}><strong>{place.name}</strong><small>{place.address || '本地地点'}</small></button>)}{remote.length > 0 && <span className="j-place-provider">地点数据来自高德地图</span>}</div>}
    {open && loading && <small className="j-place-search-status" role="status">正在搜索地点…</small>}
    {open && warning && <small className="j-place-search-status" role="status">{warning}</small>}
    {value?.address && <small className="j-place-address">{value.address}</small>}
  </div>
}
