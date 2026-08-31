export type SiteStatus = 'online' | 'warning' | 'offline' | 'paused';

export type IncidentSeverity = 'critical' | 'warning' | 'info';

export type HostingProvider = 'HostGator' | 'Hostinger' | 'Cloudways' | 'VPS' | 'Vercel' | 'AWS' | 'DigitalOcean' | 'Outro';

export type MonitoringFrequency = '5min' | '15min' | '30min' | '1hour' | 'daily';

export interface CheckRecord {
  id: string;
  timestamp: string;
  status: 'online' | 'warning' | 'offline';
  httpCode: number | string;
  responseTime: number; // in seconds
  result: string;
  expectedContentFound?: boolean;
}

export type TrackingStatusColor = 'green' | 'yellow' | 'red' | 'gray';

export interface TrackingToolConfig {
  enabled: boolean;
  expectedId?: string;
  searchConsoleConfigured?: boolean; // For Search Console Sim/Não
}

export interface TrackingToolResult {
  detected: boolean;
  foundId?: string;
  expectedId?: string;
  status: TrackingStatusColor; // 'green' | 'yellow' | 'red' | 'gray'
  statusLabel: string;
  message?: string;
  lastDetectedAt?: string;
  detectionMethod?: string;
}

export interface SiteTrackingConfig {
  ga4: TrackingToolConfig;
  gtm: TrackingToolConfig;
  googleAds: TrackingToolConfig;
  metaPixel: TrackingToolConfig;
  searchConsole: TrackingToolConfig;
  rdStation: TrackingToolConfig;
  lastCheckedAt?: string;
  lastCheckTimestamp?: number;
  results?: {
    ga4: TrackingToolResult;
    gtm: TrackingToolResult;
    googleAds: TrackingToolResult;
    metaPixel: TrackingToolResult;
    searchConsole: TrackingToolResult;
    rdStation: TrackingToolResult;
  };
}

export interface Site {
  id: string;
  client: string;
  siteName: string;
  url: string;
  domain: string;
  hosting: HostingProvider;
  frequency: MonitoringFrequency;
  status: SiteStatus;
  uptime30d: number; // percentage, e.g. 99.98
  responseTime: number; // current/last in seconds e.g. 0.84
  avgResponseTime: number; // average
  sslValid: boolean;
  sslDaysRemaining: number;
  domainDaysRemaining: number;
  lastCheck: string; // relative or ISO
  httpStatus: number | string; // e.g. 200, 503, 500, 'ERR'

  // Monitoring toggles
  monitorAvailability: boolean;
  monitorResponseTime: boolean;
  monitorSsl: boolean;
  monitorDomain: boolean;
  monitorRedirects: boolean;
  monitorContent: boolean;
  expectedContentText?: string;

  // Rastreamento (Tracking)
  tracking?: SiteTrackingConfig;

  // WordPress & Active flags
  isWordPress?: boolean;
  isActive?: boolean;

  // Incident & telemetry history
  checksHistory: CheckRecord[];
  activeIncidentId?: string;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt?: string;
}

export interface DbSite {
  id: string;
  client_name: string;
  name: string;
  url: string;
  domain: string;
  hosting_provider: string;
  is_wordpress: boolean;
  is_active: boolean;
  check_interval: string;
  expected_content?: string | null;
  expected_ga4_id?: string | null;
  expected_gtm_id?: string | null;
  expected_google_ads_id?: string | null;
  expected_meta_pixel_id?: string | null;
  uses_search_console: boolean;
  uses_rd_station: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbCheck {
  id: string;
  site_id: string;
  checked_at: string;
  status: 'online' | 'warning' | 'offline';
  http_status: number | null;
  response_time: number | null;
  final_url?: string | null;
  error_type?: string | null;
  error_message?: string | null;
}

export interface DbIncident {
  id: string;
  site_id: string;
  type: string;
  severity: IncidentSeverity;
  title: string;
  description?: string | null;
  started_at: string;
  resolved_at?: string | null;
  status: 'active' | 'resolved';
  created_at: string;
}

export type IncidentType =
  | 'Site fora do ar'
  | 'HTTP 500'
  | 'HTTP 503'
  | 'Timeout'
  | 'Erro de conexão'
  | 'Site lento'
  | 'SSL vencido'
  | 'SSL próximo do vencimento'
  | 'Domínio vencido'
  | 'Domínio próximo do vencimento'
  | 'Redirecionamento inesperado'
  | 'Conteúdo esperado não encontrado'
  | 'Rastreamento: Tag ausente'
  | 'Rastreamento: ID divergente'
  | 'Rastreamento: GA4 não encontrado'
  | 'Rastreamento: GTM não encontrado'
  | 'Rastreamento: Meta Pixel não encontrado'
  | 'Rastreamento: Google Ads não encontrado'
  | 'Rastreamento: RD Station não encontrado';

export interface Incident {
  id: string;
  siteId: string;
  client: string;
  siteName: string;
  url: string;
  type: IncidentType;
  severity: IncidentSeverity;
  status: 'active' | 'resolved';
  createdAt: string;
  duration: string;
  resolvedAt?: string;
  httpReturned: number | string;
  failedChecksCount: number;
  lastSuccessfulCheck: string;
  firstErrorCheck: string;
  currentStatus: string;
  explanation: string;
}

export interface AlertRule {
  id: string;
  name: string;
  event:
  | 'offline'
  | 'recovered'
  | 'ssl_expiring'
  | 'ssl_expired'
  | 'domain_expiring'
  | 'domain_expired'
  | 'slow_response'
  | 'http_error'
  | 'content_missing';
  channels: {
    email: boolean;
    webhook: boolean;
    whatsapp: boolean;
    telegram: boolean;
    push: boolean;
  };
  emailRecipients: string[];
  webhookUrl: string;
  enabled: boolean;
}

export interface FalseAlarmConfig {
  consecutiveChecksToAlert: number; // e.g. 3
  recheckIntervalSeconds: number; // e.g. 30
  autoResolveAfterRecoveries: number; // e.g. 2
}

export type NavigationTab = 'dashboard' | 'sites' | 'incidents' | 'alerts' | 'reports' | 'settings' | 'site-detail';
