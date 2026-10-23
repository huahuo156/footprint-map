import { Camera, Cloud, Coffee, Flower2, Heart, Leaf, MapPin, Mountain, Plane, Sparkles, Star, Sun } from 'lucide-react'
import { markDimensions, STICKER_LABELS } from '../../shared/journal-marks'

const icons = { leaf: Leaf, flower: Flower2, sun: Sun, cloud: Cloud, mountain: Mountain, plane: Plane, heart: Heart, star: Star, coffee: Coffee, pin: MapPin, camera: Camera, sparkles: Sparkles }
export default function MarkContent({ mark }) {
  const Icon = icons[mark.sticker] || Leaf
  return <span className={'j-mark-content is-' + mark.kind} data-mark-color={mark.color} style={{ fontSize: markDimensions(mark).fontSize }}>
    {mark.kind === 'text' ? mark.text : <Icon aria-label={STICKER_LABELS[mark.sticker]} />}
  </span>
}
