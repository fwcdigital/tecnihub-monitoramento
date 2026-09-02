import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { processAlertCycle, resolveEmailDeliveryBatchSize, resolveEmailDeliveryConcurrency } from './alertDeliveryService';
import { EmailProvider, EmailProviderError } from './emailAlertService';

type Row = Record<string, any>;

class FakeAlertDatabase {
  events: Row[] = [];
  deliveries: Row[] = [];
  webhooks = new Map<string, Row>();

  async rpc(name: string, args: Row) {
    if (name === 'claim_monitoring_alert_events') {
      const rows = this.events.filter((event) => !event.dispatched_at && !event.claimed_by).slice(0, args.p_limit);
      rows.forEach((event) => { event.claimed_by = args.p_claimed_by; });
      return { data: rows.map((event) => ({ ...event })), error: null };
    }
    if (name === 'fanout_monitoring_alert_event') {
      const event = this.events.find((candidate) => candidate.id === args.p_event_id && candidate.claimed_by === args.p_claimed_by);
      if (!event) return { data: 0, error: null };
      event.dispatched_at = new Date().toISOString();
      event.claimed_by = null;
      return { data: event.createdDeliveries || 0, error: null };
    }
    if (name === 'claim_due_alert_deliveries') {
      const rows = this.deliveries
        .filter((delivery) => !delivery.claimed_by && delivery.status === 'pending')
        .slice(0, args.p_limit);
      rows.forEach((delivery) => {
        delivery.claimed_by = args.p_claimed_by;
        delivery.status = 'processing';
        delivery.attempt_count = Number(delivery.attempt_count || 0) + 1;
      });
      return { data: rows.map((delivery) => ({ ...delivery })), error: null };
    }
    throw new Error(`RPC inesperada: ${name}`);
  }

  from(table: string) {
    if (table === 'alert_webhooks') {
      const database = this;
      return {
        select() {
          return {
            eq(_field: string, id: string) {
              return { maybeSingle: async () => ({ data: database.webhooks.get(id) || null, error: null }) };
            }
          };
        }
      };
    }
    if (table === 'alert_deliveries') {
      const database = this;
      return {
        update(payload: Row) {
          const filters: Array<[string, unknown]> = [];
          const builder: any = {
            eq(field: string, value: unknown) { filters.push([field, value]); return builder; },
            select() { return builder; },
            async maybeSingle() {
              const row = database.deliveries.find((candidate) => filters.every(([field, value]) => candidate[field] === value));
              if (!row) return { data: null, error: null };
              Object.assign(row, payload);
              return { data: { id: row.id }, error: null };
            }
          };
          return builder;
        }
      };
    }
    throw new Error(`Tabela inesperada: ${table}`);
  }
}

const successfulProvider: EmailProvider = {
  name: 'test', ready: true,
  async send() { return { providerMessageId: 'provider-message', responseStatus: 200 }; }
};

function emailDelivery(id = 'delivery-1'): Row {
  return {
    id,
    channel: 'email',
    email_config_id: 'email-config',
    recipient: 'destino@example.com',
    event_type: 'incident_confirmed',
    event_key: 'incident:1:confirmed',
    payload: {
      site: { clientName: 'Cliente', name: 'Portal', domain: 'portal.example', url: 'https://portal.example' },
      confirmedAt: '2026-09-02T12:00:00.000Z',
      reason: { human: 'O site não respondeu.', technicalCode: 'TIMEOUT' }
    },
    status: 'pending',
    attempt_count: 0,
    claimed_by: null
  };
}

describe('ciclo persistente de alertas', () => {
  it('faz fan-out da outbox e entrega o lote reivindicado', async () => {
    const database = new FakeAlertDatabase();
    database.events.push({ id: 'event-1', createdDeliveries: 2, dispatched_at: null, claimed_by: null });
    database.deliveries.push(emailDelivery());
    const result = await processAlertCycle(database as any, {
      runId: '10000000-0000-0000-0000-000000000001', emailProvider: successfulProvider,
      monitorPublicUrl: 'https://monitoramento.tecnihub.com.br', now: () => new Date('2026-09-02T12:00:00.000Z')
    });
    assert.equal(result.eventsClaimed, 1);
    assert.equal(result.eventsDispatched, 1);
    assert.equal(result.deliveriesCreated, 2);
    assert.equal(result.claimed, 1);
    assert.equal(result.delivered, 1);
    assert.equal(database.deliveries[0].status, 'delivered');
    assert.equal(database.deliveries[0].provider_message_id, 'provider-message');
    assert.equal(database.deliveries[0].attempt_count, 1);
  });

  it('dois alerts/run simultâneos não enviam a mesma entrega', async () => {
    const database = new FakeAlertDatabase();
    database.deliveries.push(emailDelivery());
    let sends = 0;
    const provider: EmailProvider = {
      name: 'test', ready: true,
      async send() { sends++; return { providerMessageId: 'one', responseStatus: 200 }; }
    };
    const [first, second] = await Promise.all([
      processAlertCycle(database as any, { runId: '20000000-0000-0000-0000-000000000001', emailProvider: provider }),
      processAlertCycle(database as any, { runId: '20000000-0000-0000-0000-000000000002', emailProvider: provider })
    ]);
    assert.equal(first.claimed + second.claimed, 1);
    assert.equal(first.delivered + second.delivered, 1);
    assert.equal(sends, 1);
  });

  it('reagenda falha temporária com contador real sem marcar como entregue', async () => {
    const database = new FakeAlertDatabase();
    database.deliveries.push(emailDelivery());
    const provider: EmailProvider = {
      name: 'test', ready: true,
      async send() { throw new EmailProviderError('temporariamente indisponível', 'EMAIL_NETWORK_ERROR', true); }
    };
    const now = new Date('2026-09-02T12:00:00.000Z');
    const result = await processAlertCycle(database as any, { runId: '30000000-0000-0000-0000-000000000001', emailProvider: provider, now: () => now });
    assert.equal(result.retried, 1);
    assert.equal(database.deliveries[0].status, 'pending');
    assert.equal(database.deliveries[0].attempt_count, 1);
    assert.equal(database.deliveries[0].next_attempt_at, '2026-09-02T12:01:00.000Z');
    assert.equal(database.deliveries[0].delivered_at, null);
  });

  it('encerra erro permanente e isola falha parcial do webhook entregue', async () => {
    const database = new FakeAlertDatabase();
    database.deliveries.push(emailDelivery('email-failed'), {
      id: 'webhook-ok', channel: 'webhook', webhook_id: 'webhook-1', recipient: null,
      event_type: 'recovery', event_key: 'incident:1:recovery', payload: {},
      status: 'pending', attempt_count: 0, claimed_by: null
    });
    database.webhooks.set('webhook-1', { url: 'https://hooks.example', timeout_ms: 5000 });
    const provider: EmailProvider = {
      name: 'test', ready: true,
      async send() { throw new EmailProviderError('destinatário inválido', 'INVALID_RECIPIENT', false, 422); }
    };
    const result = await processAlertCycle(database as any, {
      runId: '40000000-0000-0000-0000-000000000001', emailProvider: provider,
      postWebhook: async () => 204
    });
    assert.equal(result.delivered, 1);
    assert.equal(result.failed, 1);
    assert.equal(database.deliveries.find((row) => row.id === 'email-failed')?.status, 'failed');
    assert.equal(database.deliveries.find((row) => row.id === 'webhook-ok')?.status, 'delivered');
  });

  it('encerra após cinco tentativas mesmo quando a falha continua temporária', async () => {
    const database = new FakeAlertDatabase();
    const delivery = emailDelivery();
    delivery.attempt_count = 4;
    database.deliveries.push(delivery);
    const provider: EmailProvider = {
      name: 'test', ready: true,
      async send() { throw new EmailProviderError('timeout', 'EMAIL_TIMEOUT', true, 408); }
    };
    const result = await processAlertCycle(database as any, {
      runId: '50000000-0000-0000-0000-000000000001', emailProvider: provider
    });
    assert.equal(result.retried, 0);
    assert.equal(result.failed, 1);
    assert.equal(database.deliveries[0].attempt_count, 5);
    assert.equal(database.deliveries[0].status, 'failed');
  });

  it('limita lote e concorrência a valores seguros', () => {
    assert.equal(resolveEmailDeliveryBatchSize(undefined), 5);
    assert.equal(resolveEmailDeliveryBatchSize(500), 20);
    assert.equal(resolveEmailDeliveryConcurrency(undefined), 2);
    assert.equal(resolveEmailDeliveryConcurrency(50), 5);
  });
});
