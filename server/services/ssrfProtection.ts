import dns from 'dns/promises';
import net from 'node:net';
import { URL } from 'node:url';

const DEFAULT_DNS_TIMEOUT_MS = 5000;

export type SSRFErrorType =
  | 'INVALID_URL'
  | 'UNSUPPORTED_PROTOCOL'
  | 'SSRF_BLOCKED_HOST'
  | 'SSRF_BLOCKED_IP'
  | 'DNS_NOT_FOUND'
  | 'DNS_TIMEOUT'
  | 'DNS_ERROR';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface SSRFValidationResult {
  valid: boolean;
  errorType?: SSRFErrorType;
  error?: string;
  resolvedAddresses?: ResolvedAddress[];
}

type DnsLookup = (
  hostname: string,
  options: { all: true; verbatim: true }
) => Promise<Array<{ address: string; family: number }>>;

export function normalizeHttpUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('URL vazia.');

  const hasExplicitScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);
  return hasExplicitScheme ? trimmed : `https://${trimmed}`;
}

function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }

  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPrivateOrReservedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().split('%')[0];
  if (lower === '::' || lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true;

  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice('::ffff:'.length);
    return net.isIP(mapped) !== 4 || isPrivateOrReservedIPv4(mapped);
  }

  return (
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    /^fe[89ab]/.test(lower) ||
    lower.startsWith('ff') ||
    lower.startsWith('2001:db8:')
  );
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateOrReservedIPv4(ip);
  if (family === 6) return isPrivateOrReservedIPv6(ip);
  return true;
}

function validationError(errorType: SSRFErrorType, error: string): SSRFValidationResult {
  return { valid: false, errorType, error };
}

export async function validateUrlForSSRF(
  urlString: string,
  options: { dnsLookup?: DnsLookup; dnsTimeoutMs?: number } = {}
): Promise<SSRFValidationResult> {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(normalizeHttpUrl(urlString));
  } catch {
    return validationError('INVALID_URL', 'URL com formato inválido.');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return validationError(
      'UNSUPPORTED_PROTOCOL',
      `Protocolo "${parsedUrl.protocol}" não permitido. Apenas HTTP e HTTPS são aceitos.`
    );
  }

  if (parsedUrl.username || parsedUrl.password) {
    return validationError('INVALID_URL', 'URLs com credenciais embutidas não são permitidas.');
  }

  const hostname = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const blockedHosts = new Set([
    'localhost',
    'metadata.google.internal',
    'instance-data',
    'metadata',
    'kubernetes.default.svc'
  ]);

  if (
    blockedHosts.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan')
  ) {
    return validationError(
      'SSRF_BLOCKED_HOST',
      `O endereço "${hostname}" é local ou reservado e foi bloqueado por segurança (Anti-SSRF).`
    );
  }

  const directIpFamily = net.isIP(hostname);
  if (directIpFamily) {
    if (isPrivateOrReservedIp(hostname)) {
      return validationError(
        'SSRF_BLOCKED_IP',
        `O endereço IP "${hostname}" é privado/reservado e foi bloqueado por segurança (Anti-SSRF).`
      );
    }

    return {
      valid: true,
      resolvedAddresses: [{ address: hostname, family: directIpFamily as 4 | 6 }]
    };
  }

  const dnsLookup = options.dnsLookup || ((host, lookupOptions) => dns.lookup(host, lookupOptions));
  const dnsTimeoutMs = options.dnsTimeoutMs || DEFAULT_DNS_TIMEOUT_MS;
  let timeoutHandle: NodeJS.Timeout | undefined;

  try {
    const records = await Promise.race([
      dnsLookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const timeoutError = new Error('DNS lookup timeout') as Error & { code?: string };
          timeoutError.code = 'DNS_TIMEOUT';
          reject(timeoutError);
        }, dnsTimeoutMs);
      })
    ]);

    if (!records.length) {
      return validationError('DNS_NOT_FOUND', `Não foi possível resolver o domínio DNS "${hostname}".`);
    }

    const resolvedAddresses: ResolvedAddress[] = [];
    for (const record of records) {
      const family = net.isIP(record.address);
      if (!family || isPrivateOrReservedIp(record.address)) {
        return validationError(
          'SSRF_BLOCKED_IP',
          `O domínio "${hostname}" resolve para o IP privado/reservado ${record.address} e foi bloqueado por segurança (Anti-SSRF).`
        );
      }
      resolvedAddresses.push({ address: record.address, family: family as 4 | 6 });
    }

    return { valid: true, resolvedAddresses };
  } catch (error: any) {
    if (error?.code === 'DNS_TIMEOUT') {
      return validationError('DNS_TIMEOUT', `A resolução DNS de "${hostname}" excedeu ${dnsTimeoutMs}ms.`);
    }

    const notFoundCodes = new Set(['ENOTFOUND', 'ENODATA', 'EAI_NONAME']);
    const errorType: SSRFErrorType = notFoundCodes.has(error?.code) ? 'DNS_NOT_FOUND' : 'DNS_ERROR';
    return validationError(
      errorType,
      `Falha ao resolver DNS para "${hostname}": ${error?.message || 'domínio inexistente ou inacessível'}`
    );
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
