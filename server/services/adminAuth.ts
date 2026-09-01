import { createClient, User } from '@supabase/supabase-js';
import { getServerSupabase } from '../supabase';

export interface AdminIdentity {
  id: string;
  email: string;
  isAdmin: boolean;
  isActive: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface AdminAuthProvider {
  authenticate(email: string, password: string): Promise<AdminIdentity | null>;
  getById(userId: string): Promise<AdminIdentity | null>;
}

function mapUser(user: User): AdminIdentity {
  const bannedUntil = (user as User & { banned_until?: string | null }).banned_until;
  const isBanned = Boolean(bannedUntil && new Date(bannedUntil).getTime() > Date.now());
  return {
    id: user.id,
    email: user.email || '',
    isAdmin: user.app_metadata?.role === 'admin',
    isActive: !isBanned,
    createdAt: user.created_at,
    lastLoginAt: user.last_sign_in_at || null
  };
}

export function createSupabaseAdminAuthProvider(): AdminAuthProvider | null {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  const serviceClient = getServerSupabase();
  if (!supabaseUrl || !anonKey || !serviceClient || supabaseUrl.includes('your-project-id')) return null;

  return {
    async authenticate(email, password) {
      // An isolated, non-persistent client prevents one login from sharing auth
      // state with another concurrent request. Its token never reaches the browser.
      const authClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
      const { data, error } = await authClient.auth.signInWithPassword({ email, password });
      if (error || !data.user) return null;
      return mapUser(data.user);
    },

    async getById(userId) {
      const { data, error } = await serviceClient.auth.admin.getUserById(userId);
      if (error || !data.user) return null;
      return mapUser(data.user);
    }
  };
}
