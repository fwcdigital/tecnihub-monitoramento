import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { executeHttpCheck } from '../server/services/httpChecker';
import { getDomainRdapDiagnostics } from '../server/services/domainRdapService';

dotenv.config();

interface ReadOnlyTarget {
  url: string;
  domain: string;
  is_wordpress: boolean;
  expected_content: string | null;
}

function configured(value: string): boolean {
  return Boolean(value && !/your-|change[-_ ]?me|placeholder/i.test(value));
}

async function loadTarget(): Promise<{ target: ReadOnlyTarget; source: 'existing_site' | 'public_reference' }> {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (configured(supabaseUrl) && configured(serviceRole)) {
    const fetchWithTimeout: typeof fetch = (input, init = {}) => fetch(input, {
      ...init,
      signal: AbortSignal.timeout(8_000)
    });
    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithTimeout }
    });
    try {
      const { data, error } = await supabase.from('sites')
        .select('url, domain, is_wordpress, expected_content')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (!error && data?.url && data?.domain) return { target: data as ReadOnlyTarget, source: 'existing_site' };
    } catch {
      // Network/configuration dependency is reported by falling back to a public reference.
    }
  }
  return {
    target: { url: 'https://example.com', domain: 'example.com', is_wordpress: false, expected_content: null },
    source: 'public_reference'
  };
}

function memoryRdapCache() {
  return {
    from(table: string) {
      if (table !== 'domain_rdap_cache') throw new Error('Tabela inesperada no cache controlado.');
      return {
        select() { return { eq() { return { maybeSingle: async () => ({ data: null, error: null }) }; } }; },
        upsert: async () => ({ error: null })
      };
    }
  } as any;
}

async function main() {
  const { target, source } = await loadTarget();
  const [http, initialRdap] = await Promise.all([
    executeHttpCheck(target.url, 15_000, {}, { expectedContent: target.expected_content }),
    getDomainRdapDiagnostics(memoryRdapCache(), target.domain)
  ]);
  const rdapFallbackUsed = initialRdap.status === 'error' && target.domain !== 'example.com';
  const rdap = rdapFallbackUsed
    ? await getDomainRdapDiagnostics(memoryRdapCache(), 'example.com')
    : initialRdap;
  let wordpress: Record<string, unknown> = {
    applicable: target.is_wordpress || Boolean(http.wordpress?.detected),
    detectedOnHomepage: Boolean(http.wordpress?.detected)
  };
  if (wordpress.applicable) {
    const origin = new URL(http.finalUrl).origin;
    const [admin, login] = await Promise.all([
      executeHttpCheck(new URL('/wp-admin/', origin).toString(), 15_000),
      executeHttpCheck(new URL('/wp-login.php', origin).toString(), 15_000)
    ]);
    wordpress = {
      ...wordpress,
      adminHttpStatus: admin.httpStatus,
      loginHttpStatus: login.httpStatus,
      nonInvasive: true
    };
  }
  const report = {
    mode: 'read_only_no_persistence',
    targetSource: source,
    http: {
      status: http.status,
      httpStatus: http.httpStatus,
      responseTimeMs: http.responseTime,
      redirectCount: http.redirectCount
    },
    ssl: http.ssl ? {
      applicable: http.ssl.applicable,
      valid: http.ssl.valid,
      hostnameValid: http.ssl.hostnameValid,
      expired: http.ssl.expired,
      daysRemaining: http.ssl.daysRemaining
    } : { applicable: false },
    dns: {
      ipv4Records: http.dns?.a?.length || 0,
      ipv6Records: http.dns?.aaaa?.length || 0,
      cnameRecords: http.dns?.cname?.length || 0,
      observedPublicIp: Boolean(http.observedIp)
    },
    rdap: {
      status: rdap.status,
      hasRegistrar: Boolean(rdap.registrar),
      hasExpiration: Boolean(rdap.expiresAt),
      cachedOnlyInMemory: true,
      publicReferenceFallbackUsed: rdapFallbackUsed,
      errorCategory: rdap.status === 'error' ? rdap.error : undefined
    },
    wordpress,
    expectedContent: {
      configured: Boolean(target.expected_content),
      found: http.expectedContent?.found ?? null
    }
  };
  console.log(JSON.stringify(report, null, 2));
  if (http.httpStatus === null || !http.observedIp || !http.ssl?.applicable) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Falha na validação real somente leitura.');
  process.exitCode = 1;
});
