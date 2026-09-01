import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let serverSupabase: SupabaseClient | null = null;

if (supabaseUrl && supabaseKey && !supabaseUrl.includes('your-project-id')) {
  try {
    serverSupabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  } catch {
    console.warn('[Backend Supabase] Falha ao inicializar cliente Supabase.');
  }
} else {
  console.info('[Backend Supabase] Variáveis de ambiente do Supabase não configuradas no backend.');
}

export function getServerSupabase(): SupabaseClient | null {
  // Tenta reinicializar caso as variáveis tenham sido carregadas posteriormente
  if (!serverSupabase) {
    const currentUrl = process.env.SUPABASE_URL || '';
    const currentKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (currentUrl && currentKey && !currentUrl.includes('your-project-id')) {
      try {
        serverSupabase = createClient(currentUrl, currentKey, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
      } catch {}
    }
  }
  return serverSupabase;
}
