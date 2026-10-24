import { CalendarDays, Heart, MapPin, Route } from 'lucide-react'
import { hasComponentContent } from './components'

export default function MemoryComponents({ entry, trips = [], compact = false, hideDate = false, limit = Infinity }) {
  const parts = (entry.components || []).filter(component => hasComponentContent(component) && !(hideDate && component.type === 'date'))
  return <span className={'j-memory-components ' + (compact ? 'is-compact' : '')}>{parts.slice(0, limit).map(component => {
    let content = component.value, icon
    if (component.type === 'date') { icon = <CalendarDays />; content = String(content).replaceAll('-', ' / ') }
    if (component.type === 'place') { icon = <MapPin />; content = content.name || '留下的坐标' }
    if (component.type === 'trip') { icon = <Route />; content = trips.find(trip => trip.id === content)?.name || '旅程' }
    if (component.type === 'mood') icon = <Heart />
    return <span key={component.type} data-component={component.type} className={'j-memory-component j-component-' + component.type}>{icon}<span>{content}</span></span>
  })}{parts.length > limit && <span className="j-component-more">＋{parts.length - limit} 项</span>}</span>
}
