import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import type { TLSSocket } from 'node:tls';
import { URL } from 'node:url';
import {
  normalizeHttpUrl,
  isPrivateOrReservedIp,
  ResolvedAddress,
  SSRFValidationResult,
  validateUrlForSSRF
} from './ssrfProtection';

export type CheckStatus = 'online' | 'warning' | 'critical' | 'offline' | 'security_blocked';

export interface SslDiagnostics {
  applicable: boolean;
  valid: boolean | null;
  hostnameValid: boolean | null;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  daysRemaining?: number;
  expired?: boolean;
  severity: 'normal' | 'warning' | 'critical' | 'not_applicable' | 'unavailable';
  error?: string;
}

export interface DnsDiagnostics {
  a: string[];
  aaaa: string[];
  cname: string[];
  observedIp?: string;
}

export interface TrackingEvidence {
  detected: boolean;
  foundIds: string[];
  expectedId?: string;
  expectedIdFound?: boolean;
  evidence: string[];
  confirmation: 'html_evidence_only' | 'not_detected';
}

export interface TrackingDiagnostics {
  ga4: TrackingEvidence;
  gtm: TrackingEvidence;
  googleAds: TrackingEvidence;
  metaPixel: TrackingEvidence;
  rdStation: TrackingEvidence;
}

export interface CheckExecutionResult {
  status: CheckStatus;
  httpStatus: number | null;
  responseTime: number;
  finalUrl: string;
  errorType?: string;
  errorMessage?: string;
  resultMessage: string;
  observedIp?: string;
  dns?: DnsDiagnostics;
  ssl?: SslDiagnostics;
  expectedContent?: { configured: boolean; found: boolean | null };
  tracking?: TrackingDiagnostics;
  wordpress?: Record<string, unknown>;
  redirectCount: number;
  incidentEligible: boolean;
}

interface RawHttpResponse {
  statusCode: number;
  location?: string;
  body?: string;
  observedIp?: string;
  ssl?: SslDiagnostics;
}

export interface HttpCheckOptions {
  expectedContent?: string | null;
  evaluateSsl?: boolean;
  trackingExpectations?: {
    ga4?: string | null;
    gtm?: string | null;
    googleAds?: string | null;
    metaPixel?: string | null;
    rdStation?: boolean;
  };
  bodyLimitBytes?: number;
}

export interface HttpCheckerDependencies {
  validateUrl?: (url: string) => Promise<SSRFValidationResult>;
  requestUrl?: (
    url: URL,
    address: ResolvedAddress,
    timeoutMs: number,
    bodyLimitBytes?: number
  ) => Promise<RawHttpResponse>;
  resolveA?: (hostname: string) => Promise<string[]>;
  resolveAaaa?: (hostname: string) => Promise<string[]>;
  resolveCname?: (hostname: string) => Promise<string[]>;
}

export const DEFAULT_TIMEOUT_MS = 10000;
export const MAX_REDIRECTS = 5;
export const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

function messageForClientError(httpCode: number): string {
  if (httpCode === 401) return 'acesso não autorizado/protegido';
  if (httpCode === 403) return 'acesso proibido ou protegido pelo servidor';
  if (httpCode === 429) return 'limite de requisições excedido';
  if (httpCode === 404) return 'recurso não encontrado';
  return 'o servidor respondeu com uma restrição ou erro do cliente';
}

export function classifyHttpStatus(
  httpCode: number,
  responseTime: number,
  finalUrl: string
): CheckExecutionResult {
  if (httpCode >= 200 && httpCode <= 399) {
    return {
      status: 'online', httpStatus: httpCode, responseTime, finalUrl,
      resultMessage: `Servidor respondendo normalmente (HTTP ${httpCode} em ${responseTime}ms)`,
      redirectCount: 0, incidentEligible: false
    };
  }
  if (httpCode >= 400 && httpCode <= 499) {
    const reason = messageForClientError(httpCode);
    return {
      status: 'warning', httpStatus: httpCode, responseTime, finalUrl,
      errorType: `HTTP_${httpCode}`,
      errorMessage: `Servidor retornou HTTP ${httpCode}: ${reason}.`,
      resultMessage: `Atenção: servidor retornou HTTP ${httpCode} (${reason}).`,
      redirectCount: 0, incidentEligible: false
    };
  }
  if (httpCode >= 500 && httpCode <= 599) {
    return {
      status: 'critical', httpStatus: httpCode, responseTime, finalUrl,
      errorType: `HTTP_${httpCode}`,
      errorMessage: `Erro do servidor remoto (HTTP ${httpCode}).`,
      resultMessage: `CRÍTICO: servidor retornou erro HTTP ${httpCode}.`,
      redirectCount: 0, incidentEligible: true
    };
  }
  return {
    status: 'warning', httpStatus: httpCode, responseTime, finalUrl,
    errorType: `HTTP_${httpCode}`,
    errorMessage: `Resposta HTTP incomum (${httpCode}).`,
    resultMessage: `Atenção: resposta HTTP incomum (${httpCode}).`,
    redirectCount: 0, incidentEligible: false
  };
}

function sslFromSocket(url: URL, socket: TLSSocket): SslDiagnostics {
  if (url.protocol !== 'https:') {
    return { applicable: false, valid: null, hostnameValid: null, severity: 'not_applicable' };
  }
  let certificate: ReturnType<TLSSocket['getPeerCertificate']>;
  try {
    certificate = socket.getPeerCertificate();
  } catch {
    return {
      applicable: true, valid: null, hostnameValid: null, severity: 'unavailable',
      error: 'O runtime encerrou o socket antes da leitura do certificado.'
    };
  }
  if (!certificate || !certificate.valid_to) {
    return {
      applicable: true, valid: null, hostnameValid: null, severity: 'unavailable',
      error: 'O servidor não forneceu detalhes utilizáveis do certificado.'
    };
  }
  const validFromDate = new Date(certificate.valid_from);
  const validToDate = new Date(certificate.valid_to);
  const now = Date.now();
  const daysRemaining = Math.ceil((validToDate.getTime() - now) / 86_400_000);
  const expired = daysRemaining < 0;
  const severity = expired || daysRemaining <= 7 ? 'critical' : daysRemaining <= 30 ? 'warning' : 'normal';
  return {
    applicable: true,
    valid: socket.authorized && !expired && validFromDate.getTime() <= now,
    hostnameValid: socket.authorized,
    issuer: String(certificate.issuer?.O || certificate.issuer?.CN || '') || undefined,
    validFrom: Number.isFinite(validFromDate.getTime()) ? validFromDate.toISOString() : certificate.valid_from,
    validTo: Number.isFinite(validToDate.getTime()) ? validToDate.toISOString() : certificate.valid_to,
    daysRemaining, expired, severity,
    error: socket.authorized ? undefined : socket.authorizationError?.toString()
  };
}

function performPinnedRequest(
  url: URL,
  address: ResolvedAddress,
  timeoutMs: number,
  bodyLimitBytes = DEFAULT_BODY_LIMIT_BYTES
): Promise<RawHttpResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const defaultPort = url.protocol === 'https:' ? 443 : 80;
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const hostHeader = url.port ? `${hostname}:${url.port}` : hostname;
    const request = transport.request({
      protocol: url.protocol,
      hostname: address.address,
      family: address.family,
      port: url.port ? Number(url.port) : defaultPort,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      servername: url.protocol === 'https:' ? hostname : undefined,
      rejectUnauthorized: true,
      headers: {
        Host: hostHeader,
        'User-Agent': 'TecnihubMonitoring/2.0 (+https://tecnihub.com.br)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        Connection: 'close'
      }
    }, (response) => {
      const chunks: Buffer[] = [];
      let storedBytes = 0;
      let completed = false;
      // Capture transport diagnostics while the socket is certainly alive. Some
      // hosting runtimes release TLS peer-certificate details before `end`.
      const observedIp = response.socket.remoteAddress?.replace(/^::ffff:/, '');
      const ssl = sslFromSocket(url, response.socket as TLSSocket);
      const finish = () => {
        if (completed) return;
        completed = true;
        resolve({
          statusCode: response.statusCode || 0,
          location: response.headers.location,
          body: Buffer.concat(chunks).toString('utf8'),
          observedIp,
          ssl
        });
      };
      response.on('data', (chunk: Buffer | string) => {
        if (storedBytes >= bodyLimitBytes) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = bodyLimitBytes - storedBytes;
        chunks.push(buffer.subarray(0, remaining));
        storedBytes += Math.min(buffer.length, remaining);
        if (storedBytes >= bodyLimitBytes) {
          finish();
          response.destroy();
        }
      });
      response.on('end', finish);
    });
    request.setTimeout(timeoutMs, () => {
      const timeoutError = new Error(`Tempo limite de ${timeoutMs}ms excedido.`) as Error & { code?: string };
      timeoutError.code = 'ETIMEDOUT';
      request.destroy(timeoutError);
    });
    request.on('error', reject);
    request.end();
  });
}

function tlsErrorDiagnostics(code: string, message?: string): SslDiagnostics | undefined {
  const tlsCodes = new Set([
    'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN'
  ]);
  if (!tlsCodes.has(code)) return undefined;
  return {
    applicable: true, valid: false,
    hostnameValid: code === 'ERR_TLS_CERT_ALTNAME_INVALID' ? false : null,
    expired: code === 'CERT_HAS_EXPIRED', severity: 'critical', error: message || code
  };
}

function mapConnectionError(
  error: any,
  responseTime: number,
  finalUrl: string,
  dnsDiagnostics?: DnsDiagnostics
): CheckExecutionResult {
  const code = error?.code || error?.cause?.code || 'CONNECTION_ERROR';
  const common = {
    httpStatus: null, responseTime, finalUrl, redirectCount: 0, incidentEligible: true,
    dns: dnsDiagnostics, observedIp: dnsDiagnostics?.observedIp,
    ssl: tlsErrorDiagnostics(code, error?.message)
  } as const;
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return {
    ...common, status: 'offline', errorType: 'TIMEOUT',
    errorMessage: 'O servidor não respondeu dentro do tempo limite.',
    resultMessage: 'OFFLINE: timeout ao aguardar resposta do servidor.'
  };
  if (code === 'ECONNREFUSED') return {
    ...common, status: 'offline', errorType: 'CONNECTION_REFUSED',
    errorMessage: 'O host recusou a conexão.', resultMessage: 'OFFLINE: conexão recusada pelo host.'
  };
  if (common.ssl) return {
    ...common, status: 'critical', errorType: 'TLS_ERROR',
    errorMessage: error?.message || 'Falha ao validar o certificado TLS.',
    resultMessage: 'CRÍTICO: não foi possível estabelecer uma conexão HTTPS com certificado válido.'
  };
  return {
    ...common, status: 'offline', errorType: code,
    errorMessage: error?.message || 'Falha ao conectar no host remoto.',
    resultMessage: `OFFLINE: falha real de conexão (${code}).`
  };
}

function uniqueMatches(body: string, expression: RegExp): string[] {
  return [...new Set(Array.from(body.matchAll(expression), (match) => match[1] || match[0]))];
}

function evidence(
  body: string,
  ids: string[],
  markers: Array<{ pattern: RegExp; label: string }>,
  expectedId?: string | null
): TrackingEvidence {
  const evidenceLabels = markers.filter(({ pattern }) => pattern.test(body)).map(({ label }) => label);
  const detected = ids.length > 0 || evidenceLabels.length > 0;
  const normalizedExpected = expectedId?.trim();
  return {
    detected, foundIds: ids, expectedId: normalizedExpected || undefined,
    expectedIdFound: normalizedExpected ? body.toLowerCase().includes(normalizedExpected.toLowerCase()) : undefined,
    evidence: evidenceLabels, confirmation: detected ? 'html_evidence_only' : 'not_detected'
  };
}

export function detectTrackingEvidence(
  body: string,
  expectations: HttpCheckOptions['trackingExpectations'] = {}
): TrackingDiagnostics {
  return {
    gtm: evidence(body, uniqueMatches(body, /\b(GTM-[A-Z0-9]+)\b/gi), [
      { pattern: /googletagmanager\.com\/gtm\.js/i, label: 'script_gtm' }
    ], expectations?.gtm),
    ga4: evidence(body, uniqueMatches(body, /\b(G-[A-Z0-9]{5,}|UA-\d+-\d+)\b/gi), [
      { pattern: /googletagmanager\.com\/gtag\/js/i, label: 'script_gtag' },
      { pattern: /gtag\s*\(\s*['"]config['"]/i, label: 'config_gtag' },
      { pattern: /google-analytics\.com\/(?:analytics|collect)\.js/i, label: 'script_google_analytics' }
    ], expectations?.ga4),
    googleAds: evidence(body, uniqueMatches(body, /\b(AW-\d+)\b/gi), [
      { pattern: /googleadservices\.com|googleads\.g\.doubleclick\.net/i, label: 'script_google_ads' }
    ], expectations?.googleAds),
    metaPixel: evidence(body, [...new Set([
      ...uniqueMatches(body, /fbq\s*\(\s*['"]init['"]\s*,\s*['"]?(\d+)['"]?/gi),
      ...uniqueMatches(body, /facebook\.com\/tr\?[^"'<>]*\bid=(\d+)/gi)
    ])], [
      { pattern: /connect\.facebook\.net\/.+\/fbevents\.js/i, label: 'script_meta_pixel' }
    ], expectations?.metaPixel),
    rdStation: evidence(body, [], [
      { pattern: /rdstation\.com|rdstation-static|rdstation_forms|d335luupugsy2\.cloudfront\.net\/js\/loader-scripts/i, label: 'script_rd_station' }
    ])
  };
}

function hasMissingExpectedTracking(tracking: TrackingDiagnostics): boolean {
  return Object.values(tracking).some((tool) => tool.expectedId && tool.expectedIdFound === false);
}

async function resolveDnsRecords(
  hostname: string,
  resolvedAddresses: ResolvedAddress[],
  dependencies: HttpCheckerDependencies
): Promise<Pick<DnsDiagnostics, 'a' | 'aaaa' | 'cname'>> {
  const injectedValidation = Boolean(dependencies.validateUrl);
  const fallbackA = resolvedAddresses.filter((record) => record.family === 4).map((record) => record.address);
  const fallbackAaaa = resolvedAddresses.filter((record) => record.family === 6).map((record) => record.address);
  const safeResolve = async (resolver: (() => Promise<string[]>) | undefined): Promise<string[]> => {
    if (!resolver) return [];
    try {
      return await new Promise<string[]>((resolve) => {
        const timer = setTimeout(() => resolve([]), 3_000);
        resolver().then(
          (records) => { clearTimeout(timer); resolve(records); },
          () => { clearTimeout(timer); resolve([]); }
        );
      });
    } catch {
      return [];
    }
  };
  const [resolvedA, resolvedAaaa, cname] = await Promise.all([
    safeResolve(dependencies.resolveA
      ? () => dependencies.resolveA!(hostname)
      : injectedValidation ? undefined : () => dns.resolve4(hostname)),
    safeResolve(dependencies.resolveAaaa
      ? () => dependencies.resolveAaaa!(hostname)
      : injectedValidation ? undefined : () => dns.resolve6(hostname)),
    safeResolve(dependencies.resolveCname
      ? () => dependencies.resolveCname!(hostname)
      : injectedValidation ? undefined : () => dns.resolveCname(hostname))
  ]);
  const publicUnique = (values: string[]) => [...new Set(values.filter((value) => !isPrivateOrReservedIp(value)))];
  return {
    a: publicUnique([...resolvedA, ...fallbackA]),
    aaaa: publicUnique([...resolvedAaaa, ...fallbackAaaa]),
    cname: [...new Set(cname.map((record) => record.replace(/\.$/, '')))]
  };
}

export async function executeHttpCheck(
  targetUrl: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  dependencies: HttpCheckerDependencies = {},
  options: HttpCheckOptions = {}
): Promise<CheckExecutionResult> {
  let currentUrl: string;
  try { currentUrl = normalizeHttpUrl(targetUrl); } catch {
    return {
      status: 'offline', httpStatus: null, responseTime: 0, finalUrl: targetUrl,
      errorType: 'INVALID_URL', errorMessage: 'URL com formato inválido.',
      resultMessage: 'OFFLINE: URL inválida e não verificável.', redirectCount: 0, incidentEligible: true
    };
  }
  const validateUrl = dependencies.validateUrl || validateUrlForSSRF;
  const requestUrl = dependencies.requestUrl || performPinnedRequest;
  const startedAt = process.hrtime.bigint();

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const validation = await validateUrl(currentUrl);
    const elapsedMs = () => Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
    if (!validation.valid || !validation.resolvedAddresses?.length) {
      const isSecurityBlock = validation.errorType?.startsWith('SSRF_');
      const isDnsFailure = validation.errorType?.startsWith('DNS_');
      return {
        status: isSecurityBlock ? 'security_blocked' : 'offline', httpStatus: null,
        responseTime: elapsedMs(), finalUrl: currentUrl,
        errorType: isSecurityBlock ? 'SSRF_BLOCKED' : validation.errorType || 'INVALID_URL',
        errorMessage: validation.error,
        resultMessage: isSecurityBlock ? `Bloqueado por segurança: ${validation.error}`
          : isDnsFailure ? `OFFLINE: falha de DNS. ${validation.error}`
            : `OFFLINE: ${validation.error || 'URL inválida.'}`,
        redirectCount, incidentEligible: !isSecurityBlock
      };
    }
    const parsedUrl = new URL(currentUrl);
    const selectedAddress = validation.resolvedAddresses[0];
    const resolvedDns = await resolveDnsRecords(parsedUrl.hostname, validation.resolvedAddresses, dependencies);
    const dnsDiagnostics: DnsDiagnostics = {
      ...resolvedDns,
      observedIp: selectedAddress.address
    };
    const remainingTimeout = Math.max(1, timeoutMs - elapsedMs());
    if (remainingTimeout <= 1) return mapConnectionError({ code: 'ETIMEDOUT' }, elapsedMs(), currentUrl, dnsDiagnostics);
    try {
      const response = await requestUrl(parsedUrl, selectedAddress, remainingTimeout, options.bodyLimitBytes || DEFAULT_BODY_LIMIT_BYTES);
      if (response.statusCode >= 300 && response.statusCode <= 399 && response.location) {
        if (redirectCount === MAX_REDIRECTS) return {
          status: 'warning', httpStatus: response.statusCode, responseTime: elapsedMs(), finalUrl: currentUrl,
          errorType: 'TOO_MANY_REDIRECTS',
          errorMessage: `Excesso de redirecionamentos (mais de ${MAX_REDIRECTS} saltos).`,
          resultMessage: `Atenção: excesso de redirecionamentos (HTTP ${response.statusCode}).`,
          observedIp: response.observedIp || selectedAddress.address, dns: dnsDiagnostics, ssl: response.ssl,
          redirectCount, incidentEligible: false
        };
        currentUrl = new URL(response.location, currentUrl).toString();
        continue;
      }
      const result = classifyHttpStatus(response.statusCode, elapsedMs(), currentUrl);
      const body = response.body || '';
      const expected = options.expectedContent?.trim();
      const expectedFound = expected ? body.toLocaleLowerCase().includes(expected.toLocaleLowerCase()) : null;
      const tracking = detectTrackingEvidence(body, options.trackingExpectations);
      result.observedIp = response.observedIp || selectedAddress.address;
      result.dns = { ...dnsDiagnostics, observedIp: result.observedIp };
      result.ssl = response.ssl;
      result.expectedContent = { configured: Boolean(expected), found: expectedFound };
      result.tracking = tracking;
      result.wordpress = {
        detected: /wp-content|wp-includes|<meta[^>]+generator[^>]+wordpress/i.test(body),
        homepage: { httpStatus: response.statusCode, available: response.statusCode >= 200 && response.statusCode <= 499 },
        maintenanceDetected: /briefly unavailable for scheduled maintenance|modo de manuten[cç][aã]o|maintenance mode/i.test(body),
        criticalErrorDetected: /there has been a critical error on this website|houve um erro cr[ií]tico neste site/i.test(body)
      };
      result.redirectCount = redirectCount;

      if (result.status === 'online' && expected && !expectedFound) {
        result.status = 'warning'; result.errorType = 'EXPECTED_CONTENT_MISSING';
        result.errorMessage = 'O servidor respondeu, mas o conteúdo esperado não foi encontrado no HTML analisado.';
        result.resultMessage = 'Atenção: HTTP válido sem o conteúdo esperado.';
      } else if (result.status === 'online' && hasMissingExpectedTracking(tracking)) {
        result.status = 'warning'; result.errorType = 'EXPECTED_TRACKING_TAG_MISSING';
        result.errorMessage = 'Uma ou mais tags configuradas não foram encontradas no HTML analisado.';
        result.resultMessage = 'Atenção: tag esperada não detectada; funcionamento não foi confirmado.';
      }
      if (options.evaluateSsl !== false && result.status === 'online' && response.ssl?.severity === 'warning') {
        result.status = 'warning'; result.errorType = 'SSL_EXPIRING';
        result.errorMessage = `O certificado TLS expira em ${response.ssl.daysRemaining} dia(s).`;
        result.resultMessage = `Atenção: certificado TLS próximo do vencimento (${response.ssl.daysRemaining} dias).`;
      } else if (options.evaluateSsl !== false && (result.status === 'online' || result.status === 'warning') && response.ssl?.severity === 'critical') {
        result.status = 'critical'; result.errorType = response.ssl.expired ? 'SSL_EXPIRED' : 'SSL_EXPIRING_CRITICAL';
        result.errorMessage = response.ssl.expired ? 'O certificado TLS está expirado.'
          : `O certificado TLS expira em ${response.ssl.daysRemaining} dia(s).`;
        result.resultMessage = response.ssl.expired ? 'CRÍTICO: certificado TLS expirado.'
          : `CRÍTICO: certificado TLS expira em ${response.ssl.daysRemaining} dia(s).`;
        result.incidentEligible = Boolean(response.ssl.expired);
      }
      return result;
    } catch (error: any) {
      return mapConnectionError(error, elapsedMs(), currentUrl, dnsDiagnostics);
    }
  }
  return {
    status: 'warning', httpStatus: null,
    responseTime: Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000),
    finalUrl: currentUrl, errorType: 'UNKNOWN',
    resultMessage: 'Atenção: condição inesperada durante a verificação.',
    redirectCount: MAX_REDIRECTS, incidentEligible: false
  };
}
