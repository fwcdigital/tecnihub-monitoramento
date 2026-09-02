import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EmailProviderError,
  renderMonitoringEmail,
  ResendEmailProvider,
  resolveEmailRequestTimeout
} from './emailAlertService';

const incidentPayload = {
  site: {
    clientName: 'Cliente Exemplo',
    name: 'Portal Exemplo',
    domain: 'cliente.com.br',
    url: 'https://cliente.com.br'
  },
  confirmedAt: '2026-09-02T12:42:00.000Z',
  reason: {
    human: 'Falha na conexão HTTPS/SSL',
    technicalCode: 'EPROTO'
  }
};

describe('conteúdo das notificações por e-mail', () => {
  it('renderiza queda com mensagem humana principal e código técnico secundário', () => {
    const email = renderMonitoringEmail('incident_confirmed', incidentPayload, 'https://monitoramento.tecnihub.com.br');
    assert.equal(email.subject, '[TECNIHUB] Site fora do ar — Portal Exemplo');
    assert.match(email.text, /SITE FORA DO AR/);
    assert.match(email.text, /Detectamos uma indisponibilidade confirmada no site/);
    assert.match(email.text, /Motivo: Falha na conexão HTTPS\/SSL/);
    assert.match(email.text, /Detalhe técnico: EPROTO/);
    assert.ok(email.text.indexOf('Falha na conexão HTTPS/SSL') < email.text.indexOf('EPROTO'));
    assert.match(email.html, /Ver no Monitoramento/);
  });

  it('renderiza recuperação com duração e conteúdo em texto e HTML', () => {
    const payload = {
      site: { clientName: 'Cliente', name: 'Portal', domain: 'cliente.com.br', url: 'https://cliente.com.br' },
      recoveredAt: '2026-09-02T13:03:00.000Z',
      incidentDurationSeconds: 1260
    };
    const email = renderMonitoringEmail('recovery', payload, 'https://monitoramento.tecnihub.com.br');
    assert.equal(email.subject, '[TECNIHUB] Site restabelecido — Portal');
    assert.match(email.text, /SITE RESTABELECIDO/);
    assert.match(email.text, /O site voltou a responder normalmente/);
    assert.match(email.text, /Tempo de indisponibilidade: 21min/);
    assert.match(email.html, /21min/);
  });

  it('escapa conteúdo externo no HTML', () => {
    const email = renderMonitoringEmail('incident_confirmed', {
      ...incidentPayload,
      site: { ...incidentPayload.site, name: '<img src=x onerror=alert(1)>' }
    }, 'javascript:alert(1)');
    assert.doesNotMatch(email.html, /<img src=x/);
    assert.doesNotMatch(email.html, /javascript:/);
    assert.match(email.html, /&lt;img/);
  });

  it('e-mail de teste não representa incidente ou métricas', () => {
    const email = renderMonitoringEmail('email_test', { testedAt: '2026-09-02T12:00:00.000Z' }, 'https://monitoramento.tecnihub.com.br');
    assert.equal(email.subject, '[TECNIHUB] E-mail de teste');
    assert.doesNotMatch(email.text, /fora do ar/i);
    assert.doesNotMatch(email.text, /incidente confirmado/i);
  });
});

describe('adaptador Resend', () => {
  it('envia Idempotency-Key e não inclui segredo no corpo', async () => {
    let request: RequestInit | undefined;
    const provider = new ResendEmailProvider({
      apiKey: 'secret-resend-token',
      from: 'TECNIHUB <alertas@alerts.tecnihub.com.br>',
      timeoutMs: 1000,
      fetcher: async (_url, init) => {
        request = init;
        return new Response(JSON.stringify({ id: 'resend-message-1' }), { status: 200 });
      }
    });
    const result = await provider.send({
      to: 'destino@example.com', subject: 'Teste', html: '<p>Teste</p>', text: 'Teste', idempotencyKey: 'delivery-1'
    });
    assert.equal(result.providerMessageId, 'resend-message-1');
    assert.equal((request?.headers as Record<string, string>)['Idempotency-Key'], 'delivery-1');
    assert.equal(String(request?.body).includes('secret-resend-token'), false);
  });

  it('classifica 429 e 5xx como temporários e 422 como permanente', async () => {
    for (const [status, retryable] of [[429, true], [503, true], [422, false]] as const) {
      const provider = new ResendEmailProvider({
        apiKey: 'token', from: 'alertas@example.com', timeoutMs: 1000,
        fetcher: async () => new Response(JSON.stringify({ message: 'erro controlado', name: `status_${status}` }), { status })
      });
      await assert.rejects(
        provider.send({ to: 'a@example.com', subject: 'x', html: 'x', text: 'x', idempotencyKey: `key-${status}` }),
        (error: EmailProviderError) => error.retryable === retryable && error.responseStatus === status
      );
    }
  });

  it('recusa envio sem credencial configurada', async () => {
    const provider = new ResendEmailProvider({ apiKey: '', from: '', timeoutMs: 1000 });
    await assert.rejects(
      provider.send({ to: 'a@example.com', subject: 'x', html: 'x', text: 'x', idempotencyKey: 'x' }),
      (error: EmailProviderError) => error.code === 'EMAIL_PROVIDER_NOT_CONFIGURED' && !error.retryable
    );
  });

  it('mantém timeout configurável dentro de limite seguro', () => {
    assert.equal(resolveEmailRequestTimeout(undefined), 6000);
    assert.equal(resolveEmailRequestTimeout(50), 1000);
    assert.equal(resolveEmailRequestTimeout(60_000), 10_000);
  });
});
