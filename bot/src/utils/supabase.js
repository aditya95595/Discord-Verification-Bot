const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variable.');
}

async function request(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message = data?.message || data?.error || text || response.statusText;
    throw new Error(`Supabase REST ${response.status}: ${message}`);
  }

  return data;
}

export async function upsertGuildSettings(settings) {
  const data = await request('guild_settings?on_conflict=guild_id', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(settings),
  });
  return Array.isArray(data) ? data[0] : data;
}

export async function getGuildSettings(guildId) {
  const data = await request(`guild_settings?guild_id=eq.${encodeURIComponent(guildId)}&limit=1`, {
    method: 'GET',
  });
  return Array.isArray(data) ? data[0] || null : data || null;
}

export async function getPendingSession(userId, guildId) {
  const data = await request(
    `active_sessions?user_id=eq.${encodeURIComponent(userId)}&guild_id=eq.${encodeURIComponent(guildId)}&status=eq.pending&order=created_at.desc&limit=1`,
    { method: 'GET' }
  );
  return Array.isArray(data) ? data[0] || null : data || null;
}

export async function getVerifiedSession(userId, guildId) {
  const data = await request(
    `active_sessions?user_id=eq.${encodeURIComponent(userId)}&guild_id=eq.${encodeURIComponent(guildId)}&status=eq.verified&order=created_at.desc&limit=1`,
    { method: 'GET' }
  );
  return Array.isArray(data) ? data[0] || null : data || null;
}
