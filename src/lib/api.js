import { supabase } from './supabase'

export async function fetchLandmarks() {
  const { data, error } = await supabase.from('landmarks').select('*').order('name')
  if (error) throw error
  return data
}

export async function fetchCheckins({ province, limit = 50, offset = 0 } = {}) {
  let query = supabase
    .from('checkins')
    .select('*, profiles:user_id(nickname, avatar_url)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (province) query = query.eq('province', province)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function fetchMyCheckins(province) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  let query = supabase
    .from('checkins')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
  if (province) query = query.eq('province', province)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function fetchGuides({ province, limit = 20, offset = 0 } = {}) {
  let query = supabase
    .from('guides')
    .select('*, profiles:user_id(nickname, avatar_url)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (province) query = query.eq('province', province)
  const { data, error } = await query
  if (error) throw error
  return data
}

export async function createGuide({ title, content, cover_image_url, province, landmark_ids }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('guides')
    .insert({
      user_id: user.id,
      title,
      content,
      cover_image_url: cover_image_url || null,
      province: province || null,
      landmark_ids: landmark_ids || [],
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function fetchGuide(id) {
  const { data, error } = await supabase
    .from('guides')
    .select('*, profiles:user_id(nickname, avatar_url)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function toggleLike(targetId, targetType) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: existing } = await supabase
    .from('likes')
    .select('*')
    .eq('user_id', user.id)
    .eq('target_id', targetId)
    .eq('target_type', targetType)
    .single()

  if (existing) {
    const { error } = await supabase
      .from('likes')
      .delete()
      .eq('user_id', user.id)
      .eq('target_id', targetId)
      .eq('target_type', targetType)
    if (error) throw error
    return false
  } else {
    const { error } = await supabase
      .from('likes')
      .insert({ user_id: user.id, target_id: targetId, target_type: targetType })
    if (error) throw error
    return true
  }
}

export async function checkLiked(targetId, targetType) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { data } = await supabase
    .from('likes')
    .select('user_id')
    .eq('user_id', user.id)
    .eq('target_id', targetId)
    .eq('target_type', targetType)
    .maybeSingle()
  return !!data
}

export async function searchSimilar(queryText, limit = 20) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/search-similar`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ query: queryText, limit }),
    }
  )
  if (!res.ok) throw new Error('Search failed')
  return res.json()
}
