import { Site, SiteTrackingConfig, TrackingToolResult, TrackingStatusColor } from '../types';

export interface TrackingToolMeta {
  key: 'ga4' | 'gtm' | 'googleAds' | 'metaPixel' | 'rdStation' | 'searchConsole';
  name: string;
  shortName: string;
  placeholder: string;
  idLabel: string;
  idPrefixExample: string;
  description: string;
}

export const TRACKING_TOOLS: TrackingToolMeta[] = [
  {
    key: 'ga4',
    name: 'Google Analytics 4',
    shortName: 'Google Analytics',
    placeholder: 'G-XXXXXXXXXX',
    idLabel: 'ID de Métrica (Measurement ID)',
    idPrefixExample: 'G-',
    description: 'Monitora a presença da tag do GA4 e Measurement ID no código.'
  },
  {
    key: 'gtm',
    name: 'Google Tag Manager',
    shortName: 'Google Tag Manager',
    placeholder: 'GTM-XXXXXXX',
    idLabel: 'ID do Contêiner GTM',
    idPrefixExample: 'GTM-',
    description: 'Verifica se o contêiner GTM está instalado no <head> e <body>.'
  },
  {
    key: 'googleAds',
    name: 'Google Ads',
    shortName: 'Google Ads',
    placeholder: 'AW-XXXXXXXXX',
    idLabel: 'ID de Conversão Google Ads',
    idPrefixExample: 'AW-',
    description: 'Monitora a tag de remarketing/conversão do Google Ads.'
  },
  {
    key: 'metaPixel',
    name: 'Meta Pixel',
    shortName: 'Meta Pixel',
    placeholder: '123456789012345',
    idLabel: 'ID do Meta Pixel',
    idPrefixExample: 'Ex: 9876543210',
    description: 'Verifica o script do Pixel do Facebook/Meta e seu identificador.'
  },
  {
    key: 'rdStation',
    name: 'RD Station',
    shortName: 'RD Station',
    placeholder: 'dms.rdstation.com.br / Token',
    idLabel: 'Token ou Identificador RD',
    idPrefixExample: 'Ex: dms.rdstation.com.br',
    description: 'Verifica scripts de rastreamento de leads do RD Station Marketing.'
  },
  {
    key: 'searchConsole',
    name: 'Google Search Console',
    shortName: 'Google Search Console',
    placeholder: 'Status Manual (DNS/HTML)',
    idLabel: 'Status de Configuração',
    idPrefixExample: 'Configurado (Sim/Não)',
    description: 'Registro de validação de propriedade no Google Search Console (DNS/Tag).'
  }
];

/**
 * Evaluates the status of a single tracking tool based on configuration and detection.
 */
export function evaluateToolResult(
  toolKey: 'ga4' | 'gtm' | 'googleAds' | 'metaPixel' | 'rdStation' | 'searchConsole',
  config: { enabled: boolean; expectedId?: string; searchConsoleConfigured?: boolean },
  detected: boolean,
  foundId?: string,
  lastDetectedAt?: string,
  detectionMethod?: string
): TrackingToolResult {
  const toolMeta = TRACKING_TOOLS.find((t) => t.key === toolKey)!;
  const toolName = toolMeta.shortName;

  // 1. Tool not required/enabled for this client -> GRAY
  if (!config.enabled) {
    return {
      detected: false,
      status: 'gray',
      statusLabel: 'Não utilizado',
      message: `${toolName} não utilizado neste cliente.`,
      expectedId: config.expectedId,
      foundId: undefined
    };
  }

  // 2. Google Search Console (Manual Configuration Flag)
  if (toolKey === 'searchConsole') {
    const isConfigured = config.searchConsoleConfigured ?? false;
    if (isConfigured) {
      return {
        detected: true,
        status: 'green',
        statusLabel: 'Configurado',
        message: 'Propriedade configurada e validada para este domínio (via DNS/GSC).',
        expectedId: 'Configurado'
      };
    } else {
      return {
        detected: false,
        status: 'yellow',
        statusLabel: 'Não configurado',
        message: 'Search Console marcado como obrigatório, mas ainda não configurado.',
        expectedId: 'Pendente'
      };
    }
  }

  // 3. Tool is required and was NOT detected -> RED
  if (!detected) {
    return {
      detected: false,
      status: 'red',
      statusLabel: 'Não detectado',
      expectedId: config.expectedId,
      foundId: undefined,
      message: `${toolName} não foi encontrado na última verificação.`,
      lastDetectedAt: lastDetectedAt || 'Hoje às 10:15',
      detectionMethod: 'Varredura HTML / DOM Dinâmico'
    };
  }

  // 4. Tool was detected -> Check ID correspondence
  const normalizedExpected = (config.expectedId || '').trim().toUpperCase();
  const normalizedFound = (foundId || '').trim().toUpperCase();

  if (normalizedExpected && normalizedFound && normalizedExpected !== normalizedFound) {
    // ID Mismatch -> YELLOW
    return {
      detected: true,
      status: 'yellow',
      statusLabel: 'Divergência de ID',
      expectedId: config.expectedId,
      foundId: foundId,
      message: `${toolName} encontrado, mas o ID não corresponde ao cadastrado.`,
      lastDetectedAt: 'Agora mesmo',
      detectionMethod: detectionMethod || 'Detectado via HTML'
    };
  }

  // Detected and valid -> GREEN
  return {
    detected: true,
    status: 'green',
    statusLabel: 'Detectado',
    expectedId: config.expectedId,
    foundId: foundId || config.expectedId,
    message: undefined,
    lastDetectedAt: 'Agora mesmo',
    detectionMethod: detectionMethod || 'Detectado e validado'
  };
}

/**
 * Re-runs full tracking analysis for a given site configuration.
 */
export function analyzeSiteTracking(
  currentConfig?: SiteTrackingConfig,
  customSimulationOverrides?: Partial<Record<string, { detected: boolean; foundId?: string }>>
): SiteTrackingConfig {
  if (!currentConfig) {
    return createDefaultTrackingConfig();
  }

  const results: SiteTrackingConfig['results'] = {
    ga4: evaluateToolResult(
      'ga4',
      currentConfig.ga4,
      customSimulationOverrides?.ga4?.detected ?? (currentConfig.ga4.enabled ? (currentConfig.results?.ga4?.detected ?? true) : false),
      customSimulationOverrides?.ga4?.foundId ?? (currentConfig.results?.ga4?.foundId || currentConfig.ga4.expectedId),
      currentConfig.results?.ga4?.lastDetectedAt || 'Hoje às 11:20',
      'Carregado via GTM / Playwright'
    ),
    gtm: evaluateToolResult(
      'gtm',
      currentConfig.gtm,
      customSimulationOverrides?.gtm?.detected ?? (currentConfig.gtm.enabled ? (currentConfig.results?.gtm?.detected ?? true) : false),
      customSimulationOverrides?.gtm?.foundId ?? (currentConfig.results?.gtm?.foundId || currentConfig.gtm.expectedId),
      currentConfig.results?.gtm?.lastDetectedAt || 'Hoje às 11:20',
      'Inserido no <head>'
    ),
    googleAds: evaluateToolResult(
      'googleAds',
      currentConfig.googleAds,
      customSimulationOverrides?.googleAds?.detected ?? (currentConfig.googleAds.enabled ? (currentConfig.results?.googleAds?.detected ?? true) : false),
      customSimulationOverrides?.googleAds?.foundId ?? (currentConfig.results?.googleAds?.foundId || currentConfig.googleAds.expectedId),
      currentConfig.results?.googleAds?.lastDetectedAt || 'Hoje às 11:20',
      'Tag Global gtag.js'
    ),
    metaPixel: evaluateToolResult(
      'metaPixel',
      currentConfig.metaPixel,
      customSimulationOverrides?.metaPixel?.detected ?? (currentConfig.metaPixel.enabled ? (currentConfig.results?.metaPixel?.detected ?? true) : false),
      customSimulationOverrides?.metaPixel?.foundId ?? (currentConfig.results?.metaPixel?.foundId || currentConfig.metaPixel.expectedId),
      currentConfig.results?.metaPixel?.lastDetectedAt || 'Hoje às 11:20',
      'Script fbq.js'
    ),
    rdStation: evaluateToolResult(
      'rdStation',
      currentConfig.rdStation,
      customSimulationOverrides?.rdStation?.detected ?? (currentConfig.rdStation.enabled ? (currentConfig.results?.rdStation?.detected ?? true) : false),
      customSimulationOverrides?.rdStation?.foundId ?? (currentConfig.results?.rdStation?.foundId || currentConfig.rdStation.expectedId),
      currentConfig.results?.rdStation?.lastDetectedAt || 'Hoje às 11:20',
      'Script RD Station Marketing'
    ),
    searchConsole: evaluateToolResult(
      'searchConsole',
      currentConfig.searchConsole,
      currentConfig.searchConsole.searchConsoleConfigured ?? false,
      undefined,
      undefined,
      'Validação DNS / Registro.br'
    )
  };

  return {
    ...currentConfig,
    lastCheckedAt: 'Há instantes',
    lastCheckTimestamp: Date.now(),
    results
  };
}

/**
 * Creates default tracking config for a new or uninitialized site.
 */
export function createDefaultTrackingConfig(options?: Partial<SiteTrackingConfig>): SiteTrackingConfig {
  const baseConfig: SiteTrackingConfig = {
    ga4: { enabled: true, expectedId: 'G-ABC1234567' },
    gtm: { enabled: true, expectedId: 'GTM-K89W32X' },
    googleAds: { enabled: true, expectedId: 'AW-987654321' },
    metaPixel: { enabled: true, expectedId: '482910394819203' },
    searchConsole: { enabled: true, searchConsoleConfigured: true },
    rdStation: { enabled: true, expectedId: 'dms.rdstation.com.br' },
    lastCheckedAt: 'Há 2 horas',
    lastCheckTimestamp: Date.now() - 2 * 3600 * 1000,
    ...options
  };

  return analyzeSiteTracking(baseConfig);
}

/**
 * Inspects a site and returns all tracking issues (status is 'red' or 'yellow').
 */
export function getSiteTrackingIssues(site: Site): Array<{
  toolKey: string;
  toolName: string;
  status: TrackingStatusColor;
  statusLabel: string;
  message?: string;
  expectedId?: string;
  foundId?: string;
  lastDetectedAt?: string;
}> {
  if (!site.tracking || !site.tracking.results) return [];

  const issues: Array<{
    toolKey: string;
    toolName: string;
    status: TrackingStatusColor;
    statusLabel: string;
    message?: string;
    expectedId?: string;
    foundId?: string;
    lastDetectedAt?: string;
  }> = [];

  const tools: Array<'ga4' | 'gtm' | 'googleAds' | 'metaPixel' | 'rdStation' | 'searchConsole'> = [
    'ga4',
    'gtm',
    'googleAds',
    'metaPixel',
    'rdStation',
    'searchConsole'
  ];

  for (const key of tools) {
    const res = site.tracking.results[key];
    const meta = TRACKING_TOOLS.find((t) => t.key === key)!;
    if (res && (res.status === 'red' || res.status === 'yellow')) {
      issues.push({
        toolKey: key,
        toolName: meta.shortName,
        status: res.status,
        statusLabel: res.statusLabel,
        message: res.message,
        expectedId: res.expectedId,
        foundId: res.foundId,
        lastDetectedAt: res.lastDetectedAt
      });
    }
  }

  return issues;
}

/**
 * Returns total count of tracking issues across all sites.
 */
export function getTotalTrackingIssuesCount(sites: Site[]): number {
  let count = 0;
  for (const site of sites) {
    count += getSiteTrackingIssues(site).length;
  }
  return count;
}

/**
 * Returns list of sites having at least one tracking problem (red or yellow).
 */
export function getSitesWithTrackingIssues(sites: Site[]): Array<{
  site: Site;
  issues: ReturnType<typeof getSiteTrackingIssues>;
}> {
  const result: Array<{ site: Site; issues: ReturnType<typeof getSiteTrackingIssues> }> = [];
  for (const site of sites) {
    const issues = getSiteTrackingIssues(site);
    if (issues.length > 0) {
      result.push({ site, issues });
    }
  }
  return result;
}
