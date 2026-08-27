import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createGuide } from '../../lib/api'
import { ArrowLeft, Eye, Edit3, Loader2 } from 'lucide-react'

const PROVINCES = [
  '北京', '天津', '上海', '重庆', '河北', '山西', '辽宁', '吉林',
  '黑龙江', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南',
  '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西',
  '甘肃', '青海', '台湾', '内蒙古', '广西', '西藏', '宁夏', '新疆',
]

export default function GuideEditor() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [province, setProvince] = useState('')
  const [preview, setPreview] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!title.trim()) { setError('请输入标题'); return }
    setLoading(true)
    setError('')
    try {
      const guide = await createGuide({ title: title.trim(), content, province: province || null })
      navigate(`/guide/${guide.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" /> 返回
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => setPreview(!preview)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
            {preview ? <Edit3 className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {preview ? '编辑' : '预览'}
          </button>
          <button onClick={handleSubmit} disabled={loading}
            className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} 发布
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <input type="text" placeholder="攻略标题" value={title} onChange={e => setTitle(e.target.value)}
          className="w-full text-2xl font-bold bg-transparent border-none outline-none placeholder:text-gray-300" />

        <select value={province} onChange={e => setProvince(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">选择省份（可选）</option>
          {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>

        {preview ? (
          <div className="prose prose-sm max-w-none bg-white rounded-lg p-6 min-h-[400px] border border-gray-200">
            <div className="whitespace-pre-wrap text-gray-800">{content || '（空）'}</div>
          </div>
        ) : (
          <textarea placeholder={'写下你的旅行攻略...\n\n支持 Markdown 格式：\n# 标题\n## 二级标题\n- 列表项\n**加粗** *斜体*'}
            value={content} onChange={e => setContent(e.target.value)} rows={20}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm resize-y focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-mono" />
        )}

        {error && <p className="text-red-500 text-sm">{error}</p>}
      </div>
    </div>
  )
}
