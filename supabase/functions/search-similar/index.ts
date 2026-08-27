import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      })
    }

    const { query, limit = 20 } = await req.json()
    if (!query || typeof query !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing query parameter' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }

    // TODO: Replace with actual CLIP text encoding
    const queryEmbedding = Array.from({ length: 768 }, () => Math.random() * 2 - 1)

    // Try vector search first, fall back to text search
    const { data, error } = await supabase.rpc('search_checkins', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_count: limit,
    })

    if (error) {
      const { data: fallback, error: fbError } = await supabase
        .from('checkins')
        .select('id, image_url, caption, lat, lng, province, created_at')
        .ilike('caption', `%${query}%`)
        .limit(limit)
      if (fbError) throw fbError
      return new Response(JSON.stringify({
        results: (fallback || []).map(item => ({ ...item, similarity: 0.5 })),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ results: data || [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
