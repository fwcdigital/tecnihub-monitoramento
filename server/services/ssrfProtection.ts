import dns from 'dns/promises';
import { URL } from 'url';

/**
 * Verifica se um endereço IPv4 está dentro de faixas privadas, reservadas ou de loopback.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return true;

  const [b0, b1, b2, b3] = parts;

  // 0.0.0.0/8 (Rede atual)
  if (b0 === 0) return true;

  // 127.0.0.0/8 (Loopback / Localhost)
  if (b0 === 127) return true;

  // 10.0.0.0/8 (Privado Classe A)
  if (b0 === 10) return true;

  // 172.16.0.0/12 (Privado Classe B)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

  // 192.168.0.0/16 (Privado Classe C)
  if (b0 === 192 && b1 === 168) return true;

  // 169.254.0.0/16 (Link-Local / Metadata AWS, GCP, Azure 169.254.169.254)
  if (b0 === 169 && b1 === 254) return true;

  // 100.64.0.0/10 (Carrier-grade NAT)
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

  // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (Documentação e testes)
  if (b0 === 192 && b1 === 0 && b2 === 2) return true;
  if (b0 === 198 && b1 === 51 && b2 === 100) return true;
  if (b0 === 203 && b1 === 0 && b2 === 113) return true;

  // 224.0.0.0/4 (Multicast)
  if (b0 >= 224 && b0 <= 239) return true;

  // 240.0.0.0/4 (Reservado para uso futuro / broadcast)
  if (b0 >= 240) return true;

  return false;
}

/**
 * Verifica se um endereço IPv6 é privado, local ou reservado.
 */
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  // Loopback e Não especificado
  if (lower === '::1' || lower === '::' || lower === '0:0:0:0:0:0:0:1') return true;

  // IPv4 mapeado em IPv6 (::ffff:127.0.0.1)
  if (lower.startsWith('::ffff:')) {
    const ipv4 = lower.replace('::ffff:', '');
    return isPrivateIPv4(ipv4);
  }

  // Unique Local (fc00::/7)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

  // Link-Local (fe80::/10)
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;

  // Multicast (ff00::/8)
  if (lower.startsWith('ff')) return true;

  return false;
}

export interface SSRFValidationResult {
  valid: boolean;
  error?: string;
  resolvedIp?: string;
}

/**
 * Validação rigorosa contra SSRF (Server-Side Request Forgery).
 * 1. Valida se a URL é http/https.
 * 2. Bloqueia hostnames locais explícitos (localhost, internal, metadata).
 * 3. Resolve DNS do host e verifica se o IP pertence a faixas privadas/reservadas.
 */
export async function validateUrlForSSRF(urlString: string): Promise<SSRFValidationResult> {
  let parsedUrl: URL;

  try {
    // Garante protocolo se não informado
    if (!/^https?:\/\//i.test(urlString)) {
      urlString = 'https://' + urlString;
    }
    parsedUrl = new URL(urlString);
  } catch {
    return { valid: false, error: 'URL com formato inválido.' };
  }

  // 1. Protocolo estritamente http ou https
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      valid: false,
      error: `Protocolo "${parsedUrl.protocol}" não permitido. Apenas HTTP e HTTPS são aceitos.`
    };
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // 2. Bloqueio de hostnames locais conhecidos
  const blockedHosts = [
    'localhost',
    '127.0.0.1',
    '::1',
    '0.0.0.0',
    'metadata.google.internal',
    'instance-data',
    '169.254.169.254'
  ];

  if (
    blockedHosts.includes(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan')
  ) {
    return {
      valid: false,
      error: `O endereço "${hostname}" é local ou reservado e foi bloqueado por segurança (Anti-SSRF).`
    };
  }

  // 3. Se for IP direto, valida imediatamente
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    if (isPrivateIPv4(hostname)) {
      return {
        valid: false,
        error: `O endereço IP "${hostname}" é privado/reservado e foi bloqueado por segurança (Anti-SSRF).`
      };
    }
    return { valid: true, resolvedIp: hostname };
  }

  // 4. Se for IPv6 entre colchetes
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    const rawIpv6 = hostname.slice(1, -1);
    if (isPrivateIPv6(rawIpv6)) {
      return {
        valid: false,
        error: `O endereço IPv6 "${hostname}" é privado e foi bloqueado por segurança (Anti-SSRF).`
      };
    }
    return { valid: true, resolvedIp: rawIpv6 };
  }

  // 5. Resolução DNS e validação dos IPs resultantes
  try {
    const records = await dns.lookup(hostname, { all: true });

    if (!records || records.length === 0) {
      return { valid: false, error: `Não foi possível resolver o domínio DNS "${hostname}".` };
    }

    for (const record of records) {
      if (record.family === 4 && isPrivateIPv4(record.address)) {
        return {
          valid: false,
          error: `O domínio "${hostname}" resolve para o IP privado/local ${record.address} e foi bloqueado por segurança (Anti-SSRF).`
        };
      }
      if (record.family === 6 && isPrivateIPv6(record.address)) {
        return {
          valid: false,
          error: `O domínio "${hostname}" resolve para o IPv6 privado ${record.address} e foi bloqueado por segurança (Anti-SSRF).`
        };
      }
    }

    return { valid: true, resolvedIp: records[0].address };
  } catch (err: any) {
    return {
      valid: false,
      error: `Falha ao resolver DNS para "${hostname}": ${err.message || 'Domínio inexistente ou inacessível'}`
    };
  }
}
