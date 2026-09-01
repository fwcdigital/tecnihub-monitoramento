import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import {
  normalizeHttpUrl,
  ResolvedAddress,
  SSRFValidationResult,
  validateUrlForSSRF
} from './ssrfProtection';

export type CheckStatus = 'online' | 'warning' | 'critical' | 'offline';

export interface CheckExecutionResult {
  status: CheckStatus;
  httpStatus: number | null;
  responseTime: number;
  finalUrl: string;
  errorType?: string;
  errorMessage?: string;
  resultMessage: string;
}

interface RawHttpResponse {
  statusCode: number;
  location?: string;
}

export interface HttpCheckerDependencies {
  validateUrl?: (url: string) => Promise<SSRFValidationResult>;
  requestUrl?: (url: URL, address: ResolvedAddress, timeoutMs: number) => Promise<RawHttpResponse>;
}

export const DEFAULT_TIMEOUT_MS = 10000;
export const MAX_REDIRECTS = 5;

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
      status: 'online',
      httpStatus: httpCode,
      responseTime,
      finalUrl,
      resultMessage: `Servidor respondendo normalmente (HTTP ${httpCode} em ${responseTime}ms)`
    };
  }

  if (httpCode >= 400 && httpCode <= 499) {
    const reason = messageForClientError(httpCode);
    return {
      status: 'warning',
      httpStatus: httpCode,
      responseTime,
      finalUrl,
      errorType: `HTTP_${httpCode}`,
      errorMessage: `Servidor retornou HTTP ${httpCode}: ${reason}.`,
      resultMessage: `Atenção: servidor retornou HTTP ${httpCode} (${reason}).`
    };
  }

  if (httpCode >= 500 && httpCode <= 599) {
    return {
      status: 'critical',
      httpStatus: httpCode,
      responseTime,
      finalUrl,
      errorType: `HTTP_${httpCode}`,
      errorMessage: `Erro do servidor remoto (HTTP ${httpCode}).`,
      resultMessage: `CRÍTICO: servidor retornou erro HTTP ${httpCode}.`
    };
  }

  return {
    status: 'warning',
    httpStatus: httpCode,
    responseTime,
    finalUrl,
    errorType: `HTTP_${httpCode}`,
    errorMessage: `Resposta HTTP incomum (${httpCode}).`,
    resultMessage: `Atenção: resposta HTTP incomum (${httpCode}).`
  };
}

function performPinnedRequest(
  url: URL,
  address: ResolvedAddress,
  timeoutMs: number
): Promise<RawHttpResponse> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const defaultPort = url.protocol === 'https:' ? 443 : 80;
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const hostHeader = url.port ? `${hostname}:${url.port}` : hostname;

    const request = transport.request(
      {
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
          'User-Agent': 'TecnihubMonitoring/1.0 (+https://tecnihub.com.br)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          Connection: 'close'
        }
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const location = response.headers.location;
        response.resume();
        resolve({ statusCode, location });
      }
    );

    request.setTimeout(timeoutMs, () => {
      const timeoutError = new Error(`Tempo limite de ${timeoutMs}ms excedido.`) as Error & { code?: string };
      timeoutError.code = 'ETIMEDOUT';
      request.destroy(timeoutError);
    });
    request.on('error', reject);
    request.end();
  });
}

function mapConnectionError(error: any, responseTime: number, finalUrl: string): CheckExecutionResult {
  const code = error?.code || error?.cause?.code || 'CONNECTION_ERROR';

  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return {
      status: 'offline',
      httpStatus: null,
      responseTime,
      finalUrl,
      errorType: 'TIMEOUT',
      errorMessage: 'O servidor não respondeu dentro do tempo limite.',
      resultMessage: 'OFFLINE: timeout ao aguardar resposta do servidor.'
    };
  }

  if (code === 'ECONNREFUSED') {
    return {
      status: 'offline',
      httpStatus: null,
      responseTime,
      finalUrl,
      errorType: 'CONNECTION_REFUSED',
      errorMessage: 'O host recusou a conexão.',
      resultMessage: 'OFFLINE: conexão recusada pelo host.'
    };
  }

  const tlsCodes = new Set([
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
  ]);
  if (tlsCodes.has(code)) {
    return {
      status: 'offline',
      httpStatus: null,
      responseTime,
      finalUrl,
      errorType: 'TLS_ERROR',
      errorMessage: error?.message || 'Falha ao validar o certificado TLS.',
      resultMessage: 'OFFLINE: não foi possível estabelecer uma conexão HTTPS válida.'
    };
  }

  return {
    status: 'offline',
    httpStatus: null,
    responseTime,
    finalUrl,
    errorType: code,
    errorMessage: error?.message || 'Falha ao conectar no host remoto.',
    resultMessage: `OFFLINE: falha real de conexão (${code}).`
  };
}

export async function executeHttpCheck(
  targetUrl: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  dependencies: HttpCheckerDependencies = {}
): Promise<CheckExecutionResult> {
  let currentUrl: string;
  try {
    currentUrl = normalizeHttpUrl(targetUrl);
  } catch {
    return {
      status: 'offline',
      httpStatus: null,
      responseTime: 0,
      finalUrl: targetUrl,
      errorType: 'INVALID_URL',
      errorMessage: 'URL com formato inválido.',
      resultMessage: 'OFFLINE: URL inválida e não verificável.'
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
        status: 'offline',
        httpStatus: null,
        responseTime: elapsedMs(),
        finalUrl: currentUrl,
        errorType: isSecurityBlock ? 'SSRF_BLOCKED' : validation.errorType || 'INVALID_URL',
        errorMessage: validation.error,
        resultMessage: isSecurityBlock
          ? `Bloqueado por segurança: ${validation.error}`
          : isDnsFailure
            ? `OFFLINE: falha de DNS. ${validation.error}`
            : `OFFLINE: ${validation.error || 'URL inválida.'}`
      };
    }

    const parsedUrl = new URL(currentUrl);
    const remainingTimeout = Math.max(1, timeoutMs - elapsedMs());
    if (remainingTimeout <= 1) return mapConnectionError({ code: 'ETIMEDOUT' }, elapsedMs(), currentUrl);

    try {
      // Pin the connection to the IP that passed SSRF validation. The HTTP client
      // never performs a second DNS lookup, closing the DNS-rebinding window.
      const response = await requestUrl(parsedUrl, validation.resolvedAddresses[0], remainingTimeout);

      if (response.statusCode >= 300 && response.statusCode <= 399 && response.location) {
        if (redirectCount === MAX_REDIRECTS) {
          return {
            status: 'warning',
            httpStatus: response.statusCode,
            responseTime: elapsedMs(),
            finalUrl: currentUrl,
            errorType: 'TOO_MANY_REDIRECTS',
            errorMessage: `Excesso de redirecionamentos (mais de ${MAX_REDIRECTS} saltos).`,
            resultMessage: `Atenção: excesso de redirecionamentos (HTTP ${response.statusCode}).`
          };
        }
        currentUrl = new URL(response.location, currentUrl).toString();
        continue;
      }

      return classifyHttpStatus(response.statusCode, elapsedMs(), currentUrl);
    } catch (error: any) {
      return mapConnectionError(error, elapsedMs(), currentUrl);
    }
  }

  return {
    status: 'warning',
    httpStatus: null,
    responseTime: Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000),
    finalUrl: currentUrl,
    errorType: 'UNKNOWN',
    resultMessage: 'Atenção: condição inesperada durante a verificação.'
  };
}
