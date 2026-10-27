import { ArrowLeft, MapPin } from 'lucide-react'
import JournalImage from './JournalImage'
import { imageFilter } from './model'

export default function AtlasSelection({ mobile = false, collapsed = false, onToggle, group, items, onClose, onOpen }) {
  return <aside className={"j-atlas-selection" + (collapsed ? " is-collapsed" : "")} aria-label={`${group.name}的回忆`} style={{ '--selection-color': group.pinColor }}>
    <header><span><MapPin />{group.kind === 'province' ? '省份足迹' : group.kind === 'city' ? '城市回忆' : '地点回忆'}</span><button className="j-button" onClick={onClose}><ArrowLeft />返回全景</button></header>
    <h2>{group.name}</h2>
    {mobile && <button className="j-button j-atlas-sheet-toggle" aria-expanded={!collapsed} aria-label={collapsed ? "展开地点详情" : "收起地点详情"} onClick={onToggle}>{collapsed ? "展开详情" : "收起详情"}</button>}
    <div className="j-atlas-selection-details" hidden={mobile && collapsed}><dl className="j-atlas-stats">
      <div><dt>照片</dt><dd>{group.count}<small> 张</small></dd></div>
      <div title="同一旅程计一次；未标旅程时按日期合并，无日期按原始记录合并。"><dt>到访次数</dt><dd aria-label="到访次数">{group.visits}<small> 次</small></dd></div>
      <div className="j-atlas-first-visit"><dt>首次到访</dt><dd>{group.firstVisited ? <time dateTime={group.firstVisited}>{group.firstVisited}</time> : '暂无日期'}</dd></div>
    </dl>
    <div className="j-atlas-selection-photos">{items.map(item => <button key={item.photo.id} onClick={() => onOpen(item.entry, item.photo.id)} aria-label={`查看原片：${item.name || '旅行照片'} ${item.photo.id}`} title={item.name}>
      <JournalImage src={item.photo.url} alt="" style={{ filter: imageFilter(item.photo.image_filter), objectPosition: `${item.photo.crop_x ?? 50}% 50%` }} /><span>{item.name || '旅行照片'}</span>
    </button>)}</div>
    <p>{mobile ? "轻触照片重温这一刻" : "点击照片重温这一刻 · Esc 返回全景"}</p></div>
  </aside>
}
