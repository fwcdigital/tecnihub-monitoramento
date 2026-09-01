import { SupabaseClient } from '@supabase/supabase-js';

export type CredentialType = 'WORDPRESS' | 'HOSPEDAGEM' | 'FTP' | 'SFTP' | 'OUTROS';

export interface CredentialRecord {
  id: string;
  site_id: string;
  type: CredentialType;
  service_name: string | null;
  provider: string | null;
  url: string | null;
  username: string | null;
  protocol: 'FTP' | 'SFTP' | null;
  host: string | null;
  port: number | null;
  notes: string | null;
  secret_ciphertext: string;
  secret_iv: string;
  secret_auth_tag: string;
  cipher_algorithm: 'aes-256-gcm';
  cipher_version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export type CredentialMetadata = Pick<CredentialRecord,
  'type' | 'service_name' | 'provider' | 'url' | 'username' | 'protocol' | 'host' | 'port' | 'notes'>;

export interface CredentialAuditEntry {
  credential_id?: string | null;
  site_id?: string | null;
  admin_id: string;
  admin_email: string;
  action: 'credential_created' | 'credential_updated' | 'password_copied' | 'password_changed' |
    'credential_removed' | 'vault_authorized' | 'vault_authorization_failed';
  success: boolean;
  details?: Record<string, string | number | boolean | null>;
}

export interface CredentialRepository {
  siteExists(siteId: string): Promise<boolean>;
  list(siteId: string): Promise<CredentialRecord[]>;
  get(credentialId: string): Promise<CredentialRecord | null>;
  create(payload: Omit<CredentialRecord, 'id' | 'created_at' | 'updated_at'>): Promise<CredentialRecord>;
  updateMetadata(credentialId: string, payload: CredentialMetadata & { updated_by: string }): Promise<CredentialRecord | null>;
  updatePassword(credentialId: string, payload: Pick<CredentialRecord,
    'secret_ciphertext' | 'secret_iv' | 'secret_auth_tag' | 'cipher_algorithm' | 'cipher_version' | 'updated_by'>): Promise<CredentialRecord | null>;
  remove(credentialId: string): Promise<boolean>;
  audit(entry: CredentialAuditEntry): Promise<void>;
}

const NORMAL_COLUMNS = [
  'id', 'site_id', 'type', 'service_name', 'provider', 'url', 'username', 'protocol', 'host', 'port',
  'notes', 'created_by', 'updated_by', 'created_at', 'updated_at'
].join(',');

export class SupabaseCredentialRepository implements CredentialRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async siteExists(siteId: string): Promise<boolean> {
    const { data, error } = await this.supabase.from('sites').select('id').eq('id', siteId).maybeSingle();
    if (error) throw new Error('Falha ao consultar o site da credencial.');
    return Boolean(data);
  }

  async list(siteId: string): Promise<CredentialRecord[]> {
    const { data, error } = await this.supabase.from('technical_credentials').select(NORMAL_COLUMNS)
      .eq('site_id', siteId).order('created_at', { ascending: false }).limit(200);
    if (error) throw new Error('Falha ao carregar os acessos técnicos.');
    return (data || []) as unknown as CredentialRecord[];
  }

  async get(credentialId: string): Promise<CredentialRecord | null> {
    const { data, error } = await this.supabase.from('technical_credentials').select('*')
      .eq('id', credentialId).maybeSingle();
    if (error) throw new Error('Falha ao consultar a credencial.');
    return data as unknown as CredentialRecord | null;
  }

  async create(payload: Omit<CredentialRecord, 'id' | 'created_at' | 'updated_at'>): Promise<CredentialRecord> {
    const { data, error } = await this.supabase.from('technical_credentials').insert(payload)
      .select(NORMAL_COLUMNS).single();
    if (error || !data) throw new Error('Falha ao criar a credencial.');
    return data as unknown as CredentialRecord;
  }

  async updateMetadata(credentialId: string, payload: CredentialMetadata & { updated_by: string }): Promise<CredentialRecord | null> {
    const { data, error } = await this.supabase.from('technical_credentials').update(payload)
      .eq('id', credentialId).select(NORMAL_COLUMNS).maybeSingle();
    if (error) throw new Error('Falha ao atualizar a credencial.');
    return data as unknown as CredentialRecord | null;
  }

  async updatePassword(credentialId: string, payload: Pick<CredentialRecord,
    'secret_ciphertext' | 'secret_iv' | 'secret_auth_tag' | 'cipher_algorithm' | 'cipher_version' | 'updated_by'>): Promise<CredentialRecord | null> {
    const { data, error } = await this.supabase.from('technical_credentials').update(payload)
      .eq('id', credentialId).select(NORMAL_COLUMNS).maybeSingle();
    if (error) throw new Error('Falha ao alterar a senha da credencial.');
    return data as unknown as CredentialRecord | null;
  }

  async remove(credentialId: string): Promise<boolean> {
    const { error, count } = await this.supabase.from('technical_credentials').delete({ count: 'exact' }).eq('id', credentialId);
    if (error) throw new Error('Falha ao remover a credencial.');
    return (count || 0) > 0;
  }

  async audit(entry: CredentialAuditEntry): Promise<void> {
    const { error } = await this.supabase.from('credential_audit_log').insert({ ...entry, details: entry.details || {} });
    if (error) throw new Error('Falha ao registrar auditoria do cofre.');
  }
}

export function sanitizeCredential(record: CredentialRecord) {
  return {
    id: record.id,
    siteId: record.site_id,
    type: record.type,
    serviceName: record.service_name,
    provider: record.provider,
    url: record.url,
    username: record.username,
    protocol: record.protocol,
    host: record.host,
    port: record.port,
    notes: record.notes,
    password: '••••••••••••',
    hasPassword: true,
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
}
