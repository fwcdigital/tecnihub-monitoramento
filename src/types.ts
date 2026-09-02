export type SiteStatus = 'online' | 'warning' | 'critical' | 'offline' | 'security_blocked' | 'paused' | 'unknown';

export type IncidentSeverity = 'critical' | 'warning' | 'info';

export type HostingProvider = 'HostGator' | 'Hostinger' | 'Cloudways' | 'VPS' | 'Vercel' | 'AWS' | 'DigitalOcean' | 'Outro';

export type MonitoringFrequency = '5min' | '15min' | '30min' | '1hour' | 'daily';

export interface CheckRecord {
  id: string;
  timestamp: string;
  checkedAt: string;
  status: 'online' | 'warning' | 'critical' | 'offline' | 'security_blocked';
  httpCode: number | string;
  responseTime: number; // in seconds
  result: string;
  expectedContentFound?: boolean;
  errorType?: string;
  errorMessage?: string;
  incidentId?: string;
  observedIp?: string;
}

export interface PeriodMetrics {
  totalChecks: number;
  availableChecks: number;
  uptimePercent: number | null;
  avgResponseMs: number | null;
  responseSamples: number;
  minResponseMs: number | null;
  maxResponseMs: number | null;
  firstCheckAt: string | null;
  windowStart: string;
  hasFullWindow: boolean;
}

export type SiteMetrics = Partial<Record<'24h' | '7d' | '30d' | '90d', PeriodMetrics>>;

export interface MonitoringSeriesPoint {
  bucket: string;
  total_checks: number;
  available_checks: number;
  avg_response_ms: number | null;
  min_response_ms: number | null;
  max_response_ms: number | null;
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
  uptime30d: number | null;
  uptime30dReliable?: boolean;
  responseTime: number | null;
  avgResponseTime: number | null;
  sslValid: boolean | null;
  sslDaysRemaining: number | null;
  domainDaysRemaining: number | null;
  lastCheck: string; // relative or ISO
  httpStatus: number | string | null;

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
  metrics?: SiteMetrics;
  dns?: { a?: string[]; aaaa?: string[]; cname?: string[]; observedIp?: string };
  ssl?: Record<string, any> | null;
  domainInfo?: Record<string, any> | null;
  wordpress?: Record<string, any> | null;
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
  monitor_response_time?: boolean;
  monitor_ssl?: boolean;
  monitor_domain?: boolean;
  expected_content?: string | null;
  expected_ga4_id?: string | null;
  expected_gtm_id?: string | null;
  expected_google_ads_id?: string | null;
  expected_meta_pixel_id?: string | null;
  uses_search_console: boolean;
  uses_rd_station: boolean;
  created_at: string;
  updated_at: string;
  last_checked_at?: string | null;
  next_check_at?: string | null;
  consecutive_failures?: number;
  consecutive_successes?: number;
  monitoring_state?: string;
}

export interface DbCheck {
  id: string;
  site_id: string;
  checked_at: string;
  status: 'online' | 'warning' | 'critical' | 'offline' | 'security_blocked';
  http_status: number | null;
  response_time: number | null;
  incident_eligible?: boolean;
  final_url?: string | null;
  error_type?: string | null;
  error_message?: string | null;
  result_message?: string | null;
  incident_id?: string | null;
  observed_ip?: string | null;
  dns_records?: Record<string, any> | null;
  ssl?: Record<string, any> | null;
  expected_content_found?: boolean | null;
  wordpress?: Record<string, any> | null;
  domain_rdap?: Record<string, any> | null;
  redirect_count?: number;
  diagnostics?: Record<string, any> | null;
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
  duration_seconds?: number | null;
  reason?: string | null;
  failed_checks_count?: number;
  sites?: { client_name: string; name: string; url: string; domain: string } | null;
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
  startedAt: string;
  createdAt: string;
  duration: string;
  resolvedAt?: string;
  resolvedAtIso?: string;
  httpReturned: number | string;
  failedChecksCount: number | null;
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

export type CredentialType = 'WORDPRESS' | 'HOSPEDAGEM' | 'FTP' | 'SFTP' | 'OUTROS';

export interface TechnicalCredential {
  id: string;
  siteId: string;
  type: CredentialType;
  serviceName: string | null;
  provider: string | null;
  url: string | null;
  username: string | null;
  protocol: 'FTP' | 'SFTP' | null;
  host: string | null;
  port: number | null;
  notes: string | null;
  password: string;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TechnicalCredentialPayload {
  type: CredentialType;
  serviceName?: string;
  provider?: string;
  url?: string;
  username?: string;
  host?: string;
  port?: number | '';
  notes?: string;
  password?: string;
}

export type NavigationTab = 'dashboard' | 'sites' | 'accesses' | 'incidents' | 'alerts' | 'reports' | 'settings' | 'site-detail';
