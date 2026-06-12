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

  const { action, email, password, name, phone, user_id, role } = await req.json()

  if (action === 'create') {
    const assignedRole = ['admin', 'ops', 'tech'].includes(role) ? role : 'tech'
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { role: assignedRole }
    })
    if (authErr) return new Response(JSON.stringify({ error: authErr.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    const { error: profileErr } = await supabase.from('rsa_technicians').insert({
      id: authData.user.id, name, email, phone: phone || null, is_active: true
    })
    if (profileErr) return new Response(JSON.stringify({ error: profileErr.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    return new Response(JSON.stringify({ success: true, user_id: authData.user.id, role: assignedRole }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (action === 'set_role') {
    const assignedRole = ['admin', 'ops', 'tech'].includes(role) ? role : 'tech'
    const { error } = await supabase.auth.admin.updateUserById(user_id, {
      app_metadata: { role: assignedRole }
    })
    if (error) return new Response(JSON.stringify({ error: error.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    return new Response(JSON.stringify({ success: true, role: assignedRole }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (action === 'deactivate') {
    const { error } = await supabase.from('rsa_technicians').update({ is_active: false }).eq('id', user_id)
    if (error) return new Response(JSON.stringify({ error: error.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (action === 'reset_password') {
    const { error } = await supabase.auth.admin.updateUserById(user_id, { password })
    if (error) return new Response(JSON.stringify({ error: error.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  if (action === 'list') {
    const { data, error } = await supabase.from('rsa_technicians').select('*').order('created_at')
    if (error) return new Response(JSON.stringify({ error: error.message }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    return new Response(JSON.stringify({ success: true, data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
})
