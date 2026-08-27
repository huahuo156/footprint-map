import { useState } from 'react'
import { searchSimilar } from '../../lib/api'
import { getPublicUrl } from '../../lib/utils'
import { Search, Loader2, ImageIcon } from 'lucide-react'

export default function SearchPanel() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function handleSearch(e) {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setSearched(true)
    try {
      const data = await searchSimilar(query.trim())
      setResults(data.results || [])
    } catch (err) {
      console.error('Search failed:', err)
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4">
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="以文搜图，如「雪山下的湖泊」"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>
        <button type="submit" disabled={loading || !query.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
          搜索
        </button>
      </form>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          <span className="ml-2 text-sm text-gray-500">搜索中...</span>
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">没有找到匹配的照片</p>
          <p className="text-xs mt-1">试试其他关键词</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-gray-500">找到 {results.length} 张匹配照片</p>
          {results.map(item => {
            const imageUrl = item.image_url?.startsWith('http') ? item.image_url : getPublicUrl('checkin-images', item.image_url)
            return (
              <div key={item.id} className="rounded-lg overflow-hidden border border-gray-100">
                <img src={imageUrl} alt={item.caption || ''} className="w-full h-40 object-cover" />
                <div className="p-2">
                  <p className="text-xs text-gray-600">{item.caption || '无描述'}</p>
                  <div className="flex items-center justify-between mt-1 text-xs text-gray-400">
                    <span>相似度: {(item.similarity * 100).toFixed(0)}%</span>
                    <span>{item.province}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!searched && !loading && (
        <div className="text-center py-12 text-gray-400">
          <Search className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">以文搜图</p>
          <p className="text-xs mt-1">输入文字描述，找到最匹配的旅行照片</p>
        </div>
      )}
    </div>
  )
}
