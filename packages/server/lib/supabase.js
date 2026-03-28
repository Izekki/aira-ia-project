const { createClient } = require('@supabase/supabase-js');

function createMemoryStore({ supabaseUrl, supabaseKey }) {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_KEY en el entorno del servidor.');
  }

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  async function saveMemory({ content, role }) {
    const normalizedContent = String(content || '').trim();
    const normalizedRole = String(role || '').trim().toLowerCase();

    if (!normalizedContent) {
      return;
    }

    const { error } = await client.from('memories').insert({
      content: normalizedContent,
      role: normalizedRole,
      embedding: null,
    });

    if (error) {
      throw new Error(`Error guardando memoria en Supabase: ${error.message}`);
    }
  }

  async function getRecentMemories(limit = 12) {
    const { data, error } = await client
      .from('memories')
      .select('role, content, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Error leyendo memoria en Supabase: ${error.message}`);
    }

    return (data || []).reverse();
  }

  return {
    saveMemory,
    getRecentMemories,
  };
}

module.exports = {
  createMemoryStore,
};
