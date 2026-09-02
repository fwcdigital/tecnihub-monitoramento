import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getDomainRdapDiagnostics } from './domainRdapService';

function memoryCache(initial: Record<string, any> | null = null) {
  let row = initial;
  return {
    get row() { return row; },
    client: {
      from(table: string) {
        assert.equal(table, 'domain_rdap_cache');
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
          upsert: async (payload: Record<string, any>) => { row = payload; return { error: null }; },
          update: (payload: Record<string, any>) => ({
            eq: async () => { row = row ? { ...row, ...payload } : row; return { error: null }; }
          })
        };
      }
    } as any
  };
}

describe('coleta RDAP resiliente', () => {
  it('tenta o domínio registrável quando o cadastro contém subdomínio', async () => {
    const cache = memoryCache();
    const calls: string[] = [];
    const result = await getDomainRdapDiagnostics(
      cache.client,
      'painel.exemplo.com.br',
      () => new Date('2026-09-01T12:00:00.000Z'),
      async (input) => {
        calls.push(String(input));
        if (calls.length === 1) return new Response(null, { status: 404 });
        return new Response(JSON.stringify({
          ldhName: 'EXEMPLO.COM.BR',
          port43: 'whois.registro.br',
          events: [{ eventAction: 'expiration', eventDate: '2027-09-01T00:00:00.000Z' }],
          entities: [{ roles: ['registrar'], handle: 'REGISTRADOR-1' }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    );

    assert.equal(calls.length, 2);
    assert.match(calls[1], /exemplo\.com\.br$/);
    assert.equal(result.status, 'available');
    assert.equal(result.domain, 'painel.exemplo.com.br');
    assert.equal(result.registrationDomain, 'exemplo.com.br');
    assert.equal(result.registrar, 'REGISTRADOR-1');
    assert.equal(result.registry, 'whois.registro.br');
    assert.equal(cache.row?.domain, 'painel.exemplo.com.br');
  });

  it('não mantém erro transitório preso no cache de 24 horas', async () => {
    const cache = memoryCache({
      domain: 'exemplo.com', status: 'error', error_message: 'timeout',
      fetched_at: '2026-09-01T10:00:00.000Z', refresh_after: '2026-09-02T10:00:00.000Z'
    });
    let fetches = 0;
    const result = await getDomainRdapDiagnostics(
      cache.client,
      'exemplo.com',
      () => new Date('2026-09-01T12:00:00.000Z'),
      async () => {
        fetches++;
        return new Response(JSON.stringify({ ldhName: 'EXEMPLO.COM' }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }
    );

    assert.equal(fetches, 1);
    assert.equal(result.status, 'available');
  });

  it('repete uma vez quando o bootstrap RDAP limita temporariamente a consulta', async () => {
    const cache = memoryCache();
    let fetches = 0;
    const result = await getDomainRdapDiagnostics(
      cache.client,
      'exemplo.com',
      () => new Date('2026-09-01T12:00:00.000Z'),
      async () => {
        fetches++;
        if (fetches === 1) return new Response(null, { status: 429, headers: { 'Retry-After': '0' } });
        return new Response(JSON.stringify({ ldhName: 'EXEMPLO.COM' }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }
    );

    assert.equal(fetches, 2);
    assert.equal(result.status, 'available');
  });

  it('preserva o último RDAP válido durante falha temporária de atualização', async () => {
    const cache = memoryCache({
      domain: 'exemplo.com', status: 'available', registrar: 'Registrador preservado',
      raw_response: { ldhName: 'EXEMPLO.COM' },
      fetched_at: '2026-08-01T12:00:00.000Z', refresh_after: '2026-08-02T12:00:00.000Z'
    });
    const result = await getDomainRdapDiagnostics(
      cache.client,
      'exemplo.com',
      () => new Date('2026-09-01T12:00:00.000Z'),
      async () => { throw new Error('falha transitória'); }
    );

    assert.equal(result.status, 'available');
    assert.equal(result.registrar, 'Registrador preservado');
    assert.equal(result.stale, true);
  });
});
