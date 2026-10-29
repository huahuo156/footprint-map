import { useEffect, useRef, useState } from 'react'
import { ImageOff } from 'lucide-react'

export function thumbnailSource(src) {
  return typeof src === 'string' && /^\/uploads\/[\w-]+\.(jpg|png|webp)$/.test(src) ? src + '?thumbnail=1' : src
}

export default function JournalImage({ src, alt, className = '', style, loading = 'lazy', fullSize = false, onError, ...props }) {
  const [failed, setFailed] = useState(null)
  const [retried, setRetried] = useState({ source: null, count: 0 }), retryTimer = useRef(null)
  const source = fullSize ? src : thumbnailSource(src)
  const attempts = retried.source === source ? retried.count : 0
  useEffect(() => () => clearTimeout(retryTimer.current), [source])
  if (failed === source) return <span className={'j-image-failed ' + className} style={style} aria-hidden={props['aria-hidden']} role="img" aria-label={alt + '，照片暂时无法显示'}><ImageOff /><span>照片暂时无法显示</span></span>
  return <img src={source} alt={alt} className={className} style={style} loading={loading} decoding="async" draggable="false" {...props} onError={event => {
    setFailed(source)
    if (!fullSize && source !== src && attempts < 2) {
      clearTimeout(retryTimer.current)
      retryTimer.current = setTimeout(() => { setRetried({ source, count: attempts + 1 }); setFailed(null) }, 800 * (attempts + 1))
    }
    onError?.(event)
  }} />
}
