import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-secret',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const adminSecret = req.headers.get('x-admin-secret')
  if (adminSecret !== Deno.env.get('Login_key')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { action, group_id, feature_key, user_id, name, description } = await req.json()

  // --- list_groups: all groups with their features ---
  if (action === 'list_groups') {
    const { data, error } = await supabase
      .from('groups')
      .select('id, name, description, group_features(feature_key)')
      .order('name')
    if (error) return err(error.message, corsHeaders)
    return ok({ groups: data }, corsHeaders)
  }

  // --- list_users: all auth users with their groups ---
  if (action === 'list_users') {
    // Call GoTrue admin API directly to avoid JS client pagination quirks
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
    })
    if (!res.ok) {
      const body = await res.text()
      return err(`Auth API error ${res.status}: ${body}`, corsHeaders)
    }
    const json = await res.json()
    // GoTrue returns { users: [...] } or an array directly depending on version
    const userList: Array<{ id: string; email: string }> = Array.isArray(json) ? json : (json.users ?? [])

    const { data: userGroups, error: ugErr } = await supabase
      .from('user_groups')
      .select('user_id, group_id')
    if (ugErr) return err(ugErr.message, corsHeaders)

    const grouped = userList.map(u => ({
      id: u.id,
      email: u.email,
      group_ids: userGroups.filter(ug => ug.user_id === u.id).map(ug => ug.group_id)
    }))
    return ok({ users: grouped }, corsHeaders)
  }

  // --- toggle_user_group: add or remove user from group ---
  if (action === 'toggle_user_group') {
    // Superadmins are protected — their group assignments cannot be changed by anyone
    const { data: targetUser } = await supabase.auth.admin.getUserById(user_id)
    if (targetUser?.user?.app_metadata?.is_superadmin) {
      return new Response(JSON.stringify({ error: 'Superadmin group assignments cannot be modified.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const { data: existing } = await supabase
      .from('user_groups')
      .select('id')
      .eq('user_id', user_id)
      .eq('group_id', group_id)
      .maybeSingle()

    if (existing) {
      const { error } = await supabase.from('user_groups').delete().eq('id', existing.id)
      if (error) return err(error.message, corsHeaders)
      return ok({ removed: true }, corsHeaders)
    } else {
      const { error } = await supabase.from('user_groups').insert({ user_id, group_id })
      if (error) return err(error.message, corsHeaders)
      return ok({ added: true }, corsHeaders)
    }
  }

  // --- toggle_group_feature: add or remove feature from group ---
  if (action === 'toggle_group_feature') {
    const { data: existing } = await supabase
      .from('group_features')
      .select('id')
      .eq('group_id', group_id)
      .eq('feature_key', feature_key)
      .maybeSingle()

    if (existing) {
      const { error } = await supabase.from('group_features').delete().eq('id', existing.id)
      if (error) return err(error.message, corsHeaders)
      return ok({ removed: true, feature_key }, corsHeaders)
    } else {
      const { error } = await supabase.from('group_features').insert({ group_id, feature_key })
      if (error) return err(error.message, corsHeaders)
      return ok({ added: true, feature_key }, corsHeaders)
    }
  }

  // --- create_group ---
  if (action === 'create_group') {
    if (!name) return err('name is required', corsHeaders)
    const { data, error } = await supabase
      .from('groups')
      .insert({ name, description: description || null })
      .select()
      .single()
    if (error) return err(error.message, corsHeaders)
    return ok({ group: data }, corsHeaders)
  }

  // --- delete_group ---
  if (action === 'delete_group') {
    const { error } = await supabase.from('groups').delete().eq('id', group_id)
    if (error) return err(error.message, corsHeaders)
    return ok({ deleted: true }, corsHeaders)
  }

  return err('Unknown action', corsHeaders)
})

function ok(data: object, headers: Record<string, string>) {
  return new Response(JSON.stringify({ success: true, ...data }), {
    headers: { ...headers, 'Content-Type': 'application/json' }
  })
}

function err(message: string, headers: Record<string, string>) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
  })
}
