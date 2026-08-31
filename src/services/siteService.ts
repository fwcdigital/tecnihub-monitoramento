import { supabase, isSupabaseConfigured } from './supabaseClient';
import { Site, CheckRecord, Incident, DbSite, DbCheck, DbIncident, HostingProvider, MonitoringFrequency } from '../types';

/**
 * Formata um timestamp ISO ou data para hora legível
 */
function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'Agora';
  }
}

/**
 * Formata data/hora completa para histórico
 */
function formatFullDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const mins = String(date.getMinutes()).padStart(2, '0');
    const secs = String(date.getSeconds()).padStart(2, '0');
    return `${day}/${month} ${hours}:${mins}:${secs}`;
  } catch {
    return isoString;
  }
}

/**
 * Formata tempo relativo simples
 */
function formatRelativeTime(isoString: string): string {
  try {
    const now = Date.now();
    const diff = now - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Há instantes';
    if (mins === 1) return 'Há 1 min';
    if (mins < 60) return `Há ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours === 1) return 'Há 1 hora';
    if (hours < 24) return `Há ${hours} horas`;
    return 'Hoje';
  } catch {
    return 'Recente';
  }
}

/**
 * Converte registro do banco de dados (DbSite + DbChecks) para a interface Site da aplicação
 */
export function mapDbSiteToSite(dbSite: DbSite, checks: DbCheck[] = [], activeIncident?: DbIncident | null): Site {
  const latestCheck = checks.length > 0 ? checks[0] : null;

  // Converte tempo de resposta para segundos com 2 casas decimais
  const latestResponseSeconds = latestCheck?.response_time 
    ? +(latestCheck.response_time / 1000).toFixed(2) 
    : 0.85;

  const validResponseTimes = checks
    .filter(c => c.response_time && c.response_time > 0)
    .map(c => Number(c.response_time) / 1000);

  const avgResponseSeconds = validResponseTimes.length > 0
    ? +(validResponseTimes.reduce((a, b) => a + b, 0) / validResponseTimes.length).toFixed(2)
    : latestResponseSeconds;

  // Calcula taxa de uptime aproximada dos últimos checks
  const totalChecks = checks.length;
  const successfulChecks = checks.filter(c => c.status === 'online').length;
  const uptime = totalChecks > 0 ? +((successfulChecks / totalChecks) * 100).toFixed(2) : 100.0;

  // Define status atual
  let currentStatus: Site['status'] = 'online';
  if (!dbSite.is_active) {
    currentStatus = 'paused';
  } else if (latestCheck) {
    currentStatus = latestCheck.status;
  }

  // Mapeia histórico de checks
  const checksHistory: CheckRecord[] = checks.map(c => ({
    id: c.id,
    timestamp: formatFullDate(c.checked_at),
    status: c.status,
    httpCode: c.http_status ?? (c.status === 'offline' ? 'ERR' : 200),
    responseTime: c.response_time ? +(c.response_time / 1000).toFixed(2) : 0,
    result: c.error_message || (c.http_status ? `HTTP ${c.http_status} OK` : 'Servidor respondendo')
  }));

  return {
    id: dbSite.id,
    client: dbSite.client_name,
    siteName: dbSite.name,
    url: dbSite.url,
    domain: dbSite.domain,
    hosting: (dbSite.hosting_provider as HostingProvider) || 'Hostinger',
    frequency: (dbSite.check_interval as MonitoringFrequency) || '5min',
    status: currentStatus,
    isWordPress: dbSite.is_wordpress,
    isActive: dbSite.is_active,
    uptime30d: uptime,
    responseTime: currentStatus === 'offline' ? 0 : latestResponseSeconds,
    avgResponseTime: avgResponseSeconds,
    sslValid: true,
    sslDaysRemaining: 85,
    domainDaysRemaining: 240,
    lastCheck: latestCheck ? formatRelativeTime(latestCheck.checked_at) : 'Aguardando',
    httpStatus: latestCheck?.http_status ?? (currentStatus === 'offline' ? 503 : 200),
    monitorAvailability: true,
    monitorResponseTime: true,
    monitorSsl: true,
    monitorDomain: true,
    monitorRedirects: true,
    monitorContent: Boolean(dbSite.expected_content),
    expectedContentText: dbSite.expected_content || '',
    consecutiveFailures: currentStatus === 'offline' ? 1 : 0,
    createdAt: dbSite.created_at ? dbSite.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
    updatedAt: dbSite.updated_at,
    activeIncidentId: activeIncident?.id,
    checksHistory,
    tracking: {
      ga4: { enabled: Boolean(dbSite.expected_ga4_id), expectedId: dbSite.expected_ga4_id || '' },
      gtm: { enabled: Boolean(dbSite.expected_gtm_id), expectedId: dbSite.expected_gtm_id || '' },
      googleAds: { enabled: Boolean(dbSite.expected_google_ads_id), expectedId: dbSite.expected_google_ads_id || '' },
      metaPixel: { enabled: Boolean(dbSite.expected_meta_pixel_id), expectedId: dbSite.expected_meta_pixel_id || '' },
      searchConsole: { enabled: dbSite.uses_search_console, searchConsoleConfigured: dbSite.uses_search_console },
      rdStation: { enabled: dbSite.uses_rd_station, expectedId: dbSite.uses_rd_station ? 'Ativo' : '' },
      lastCheckedAt: latestCheck ? formatRelativeTime(latestCheck.checked_at) : 'Pendente'
    }
  };
}

/**
 * Busca todos os sites do Supabase com seus respectivos últimos checks
 */
export async function getSitesFromDatabase(): Promise<Site[]> {
  if (!supabase || !isSupabaseConfigured()) {
    return [];
  }

  // 1. Busca todos os sites
  const { data: dbSites, error: sitesError } = await supabase
    .from('sites')
    .select('*')
    .order('created_at', { ascending: false });

  if (sitesError || !dbSites) {
    console.error('[SiteService] Erro ao buscar sites:', sitesError);
    return [];
  }

  if (dbSites.length === 0) {
    return [];
  }

  // 2. Busca os últimos checks para cada site
  const siteIds = dbSites.map(s => s.id);
  const { data: allChecks, error: checksError } = await supabase
    .from('checks')
    .select('*')
    .in('site_id', siteIds)
    .order('checked_at', { ascending: false });

  if (checksError) {
    console.warn('[SiteService] Aviso ao buscar checks:', checksError);
  }

  // 3. Busca incidentes ativos
  const { data: activeIncidents } = await supabase
    .from('incidents')
    .select('*')
    .in('site_id', siteIds)
    .eq('status', 'active');

  const checksBySiteId: Record<string, DbCheck[]> = {};
  (allChecks || []).forEach((c: DbCheck) => {
    if (!checksBySiteId[c.site_id]) {
      checksBySiteId[c.site_id] = [];
    }
    if (checksBySiteId[c.site_id].length < 20) {
      checksBySiteId[c.site_id].push(c);
    }
  });

  const incidentBySiteId: Record<string, DbIncident> = {};
  (activeIncidents || []).forEach((inc: DbIncident) => {
    incidentBySiteId[inc.site_id] = inc;
  });

  return dbSites.map(dbSite => {
    return mapDbSiteToSite(
      dbSite as DbSite,
      checksBySiteId[dbSite.id] || [],
      incidentBySiteId[dbSite.id] || null
    );
  });
}

/**
 * Cria um novo site no Supabase
 */
export async function createSiteInDatabase(siteData: Partial<Site>): Promise<Site | null> {
  if (!supabase || !isSupabaseConfigured()) {
    throw new Error('Supabase não está configurado. Preencha as variáveis no arquivo .env.');
  }

  const newSitePayload = {
    client_name: siteData.client || 'Cliente TECNIHUB',
    name: siteData.siteName || 'Novo Site',
    url: siteData.url || 'https://tecnihub.com.br',
    domain: siteData.domain || 'tecnihub.com.br',
    hosting_provider: siteData.hosting || 'Hostinger',
    is_wordpress: Boolean(siteData.isWordPress),
    is_active: true,
    check_interval: siteData.frequency || '5min',
    expected_content: siteData.expectedContentText || null,
    expected_ga4_id: siteData.tracking?.ga4?.expectedId || null,
    expected_gtm_id: siteData.tracking?.gtm?.expectedId || null,
    expected_google_ads_id: siteData.tracking?.googleAds?.expectedId || null,
    expected_meta_pixel_id: siteData.tracking?.metaPixel?.expectedId || null,
    uses_search_console: Boolean(siteData.tracking?.searchConsole?.enabled),
    uses_rd_station: Boolean(siteData.tracking?.rdStation?.enabled)
  };

  const { data, error } = await supabase
    .from('sites')
    .insert(newSitePayload)
    .select('*')
    .single();

  if (error || !data) {
    console.error('[SiteService] Erro ao cadastrar site:', error);
    throw new Error(error?.message || 'Falha ao cadastrar site no banco.');
  }

  // Dispara uma verificação inicial automática pelo backend
  try {
    await checkSiteNow(data.id, data.url);
  } catch (err) {
    console.warn('[SiteService] Verificação inicial falhou:', err);
  }

  // Recarrega o site recém-criado com seu check
  const checks = await getChecksForSite(data.id);
  return mapDbSiteToSite(data as DbSite, checks);
}

/**
 * Atualiza os dados de um site no Supabase
 */
export async function updateSiteInDatabase(siteId: string, siteData: Partial<Site>): Promise<boolean> {
  if (!supabase || !isSupabaseConfigured()) {
    throw new Error('Supabase não está configurado.');
  }

  const updatePayload: Record<string, any> = {};
  if (siteData.client) updatePayload.client_name = siteData.client;
  if (siteData.siteName) updatePayload.name = siteData.siteName;
  if (siteData.url) updatePayload.url = siteData.url;
  if (siteData.domain) updatePayload.domain = siteData.domain;
  if (siteData.hosting) updatePayload.hosting_provider = siteData.hosting;
  if (siteData.isWordPress !== undefined) updatePayload.is_wordpress = siteData.isWordPress;
  if (siteData.frequency) updatePayload.check_interval = siteData.frequency;
  if (siteData.expectedContentText !== undefined) updatePayload.expected_content = siteData.expectedContentText || null;

  if (siteData.tracking) {
    updatePayload.expected_ga4_id = siteData.tracking.ga4?.expectedId || null;
    updatePayload.expected_gtm_id = siteData.tracking.gtm?.expectedId || null;
    updatePayload.expected_google_ads_id = siteData.tracking.googleAds?.expectedId || null;
    updatePayload.expected_meta_pixel_id = siteData.tracking.metaPixel?.expectedId || null;
    updatePayload.uses_search_console = Boolean(siteData.tracking.searchConsole?.enabled);
    updatePayload.uses_rd_station = Boolean(siteData.tracking.rdStation?.enabled);
  }

  const { error } = await supabase
    .from('sites')
    .update(updatePayload)
    .eq('id', siteId);

  if (error) {
    console.error('[SiteService] Erro ao atualizar site:', error);
    throw new Error(error.message);
  }

  return true;
}

/**
 * Exclui um site do Supabase
 */
export async function deleteSiteFromDatabase(siteId: string): Promise<boolean> {
  if (!supabase || !isSupabaseConfigured()) {
    throw new Error('Supabase não está configurado.');
  }

  const { error } = await supabase
    .from('sites')
    .delete()
    .eq('id', siteId);

  if (error) {
    console.error('[SiteService] Erro ao excluir site:', error);
    throw new Error(error.message);
  }

  return true;
}

/**
 * Alterna entre pausar e retomar o monitoramento de um site
 */
export async function togglePauseSiteInDatabase(siteId: string, currentIsActive: boolean): Promise<boolean> {
  if (!supabase || !isSupabaseConfigured()) {
    throw new Error('Supabase não está configurado.');
  }

  const { error } = await supabase
    .from('sites')
    .update({ is_active: !currentIsActive })
    .eq('id', siteId);

  if (error) {
    console.error('[SiteService] Erro ao alternar status do site:', error);
    throw new Error(error.message);
  }

  return true;
}

/**
 * Busca os checks históricos de um site específico
 */
export async function getChecksForSite(siteId: string, limit = 20): Promise<DbCheck[]> {
  if (!supabase || !isSupabaseConfigured()) {
    return [];
  }

  const { data, error } = await supabase
    .from('checks')
    .select('*')
    .eq('site_id', siteId)
    .order('checked_at', { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return data as DbCheck[];
}

/**
 * Executa uma verificação HTTP imediata pelo backend
 */
export async function checkSiteNow(siteId: string, url?: string): Promise<{
  success: boolean;
  siteId?: string;
  checkId?: string;
  result: {
    status: 'online' | 'warning' | 'offline';
    httpStatus: number | null;
    responseTime: number;
    finalUrl: string;
    errorType?: string;
    errorMessage?: string;
    resultMessage: string;
  };
  checkedAt: string;
}> {
  const response = await fetch('/api/check-site', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ siteId, url })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Falha na requisição backend (HTTP ${response.status})`);
  }

  return await response.json();
}

/**
 * Executa verificação em todos os sites pelo backend
 */
export async function checkAllSitesNow(sites?: Array<{ id: string; url: string; name: string }>): Promise<any> {
  const response = await fetch('/api/check-all', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sites })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Falha na varredura global (HTTP ${response.status})`);
  }

  return await response.json();
}
