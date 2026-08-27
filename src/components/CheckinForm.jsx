import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { randomFilename } from '../lib/utils'
import { Upload, MapPin, X, Loader2 } from 'lucide-react'

export default function CheckinForm({ lat, lng, province, landmarkId, onClose, onSuccess }) {
  const [caption, setCaption] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef()

  function handleFileChange(e) {
    const selected = e.target.files?.[0]
    if (!selected) return
    if (selected.size > 10 * 1024 * 1024) {
      setError('图片大小不能超过 10MB')
      return
    }
    setFile(selected)
    setPreview(URL.createObjectURL(selected))
    setError('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file) { setError('请选择一张照片'); return }
    setLoading(true)
    setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('请先登录')

      const filename = randomFilename(file.name)
      const filePath = `${user.id}/${filename}`
      const { error: uploadError } = await supabase.storage.from('checkin-images').upload(filePath, file)
      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage.from('checkin-images').getPublicUrl(filePath)

      const { data: checkin, error: insertError } = await supabase
        .from('checkins')
        .insert({
          user_id: user.id,
          landmark_id: landmarkId || null,
          lat, lng,
          image_url: publicUrl,
          caption: caption || null,
          province: province || null,
        })
        .select()
        .single()
      if (insertError) throw insertError

      onSuccess?.(checkin)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[2000] p-4">
      <div className="bg-white rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-bold text-gray-900">打卡</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X className="w-5 h-5 text-gray-500" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <MapPin className="w-4 h-4" />
            <span>坐标: {lat.toFixed(4)}, {lng.toFixed(4)}</span>
            {province && <span>· {province}</span>}
          </div>

          <div>
            {preview ? (
              <div className="relative">
                <img src={preview} alt="预览" className="w-full h-48 object-cover rounded-lg" />
                <button type="button" onClick={() => { setFile(null); setPreview(null) }}
                  className="absolute top-2 right-2 p-1 bg-black/50 text-white rounded-full hover:bg-black/70">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="w-full h-48 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors">
                <Upload className="w-8 h-8 mb-2" />
                <span className="text-sm">点击上传照片</span>
                <span className="text-xs mt-1">支持 JPG/PNG/WebP，最大 10MB</span>
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} className="hidden" />
          </div>

          <textarea placeholder="写下你的感受..." value={caption} onChange={e => setCaption(e.target.value)} rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button type="submit" disabled={loading || !file}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 font-medium">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
            {loading ? '上传中...' : '打卡'}
          </button>
        </form>
      </div>
    </div>
  )
}
