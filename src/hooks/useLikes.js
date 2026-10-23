import { useState, useEffect, useCallback } from 'react'
import { checkLiked, toggleLike } from '../lib/api'

export function useLikes(targetId, targetType, initialCount = 0) {
  const [liked, setLiked] = useState(false)
  const [count, setCount] = useState(initialCount)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true
    setCount(initialCount)
    setLiked(false)
    checkLiked(targetId, targetType).then(value => { if (active) setLiked(value) }).catch(() => {})
    return () => { active = false }
  }, [targetId, targetType])

  const handleToggle = useCallback(async () => {
    if (loading) return
    setLoading(true)
    try {
      const newLiked = await toggleLike(targetId, targetType)
      setLiked(newLiked)
      setCount(newLiked ? 1 : 0)
    } catch (err) {
      console.error('Like toggle failed:', err)
    } finally {
      setLoading(false)
    }
  }, [targetId, targetType, loading])

  return { liked, count, loading, toggle: handleToggle }
}
