import { useState } from 'react'
import { ImageOff } from 'lucide-react'

export default function JournalImage({ src, alt, className = '', style, loading = 'lazy', ...props }) {
  const [failed, setFailed] = useState(null)
  if (failed === src) return <span className={'j-image-failed ' + className} role="img" aria-label={alt + '，照片暂时无法显示'}><ImageOff /><span>照片暂时无法显示</span></span>
  return <img src={src} alt={alt} className={className} style={style} loading={loading} decoding="async" draggable="false" onError={() => setFailed(src)} {...props} />
}
