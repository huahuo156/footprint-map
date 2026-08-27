import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { checkLiked, toggleLike } from '../lib/api'

export function useLikes(targetId, targetType, initialCount = 0) {
  const [liked, setLiked] = useState(false)
  const [count, setCount] = useState(initialCount)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    checkLiked(targetId, targetType).then(setLiked).catch(() => {})
  }, [targetId, targetType])

  useEffect(() => {
    const channel = supabase
      .channel(`likes-${targetType}-${targetId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'likes',
        filter: `target_id=eq.${targetId}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') setCount(prev => prev + 1)
        else if (payload.eventType === 'DELETE') setCount(prev => Math.max(0, prev - 1))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [targetId, targetType])

  const handleToggle = useCallback(async () => {
    if (loading) return
    setLoading(true)
    try {
      const newLiked = await toggleLike(targetId, targetType)
      setLiked(newLiked)
    } catch (err) {
      console.error('Like toggle failed:', err)
    } finally {
      setLoading(false)
    }
  }, [targetId, targetType, loading])

  return { liked, count, loading, toggle: handleToggle }
}
