export type EmailAlertEventType = 'incident_confirmed' | 'recovery' | 'email_test';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}

export interface EmailSendResult {
  providerMessageId: string;
  responseStatus: number;
}

export interface EmailProvider {
  readonly name: string;
  readonly ready: boolean;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export class EmailProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly responseStatus?: number
  ) {
    super(message);
  }
}

interface ResendProviderOptions {
  apiKey: string;
  from: string;
  replyTo?: string;
  timeoutMs: number;
  fetcher?: typeof fetch;
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  readonly ready: boolean;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: ResendProviderOptions) {
    this.ready = Boolean(options.apiKey && options.from);
    this.fetcher = options.fetcher || fetch;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (!this.ready) {
      throw new EmailProviderError(
        'O provedor de e-mail não está configurado no servidor.',
        'EMAIL_PROVIDER_NOT_CONFIGURED',
        false
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': message.idempotencyKey
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(this.options.replyTo ? { reply_to: this.options.replyTo } : {})
        }),
        signal: controller.signal
      });
      const body = await response.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
      if (!response.ok || !body.id) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        const providerMessage = response.status === 401 || response.status === 403
          ? 'A credencial do provedor de e-mail foi recusada.'
          : response.status === 422
            ? 'O destinatário, remetente ou domínio de envio foi recusado pelo provedor.'
            : typeof body.message === 'string' && body.message.length <= 300
              ? body.message
              : `O provedor respondeu HTTP ${response.status}.`;
        throw new EmailProviderError(
          providerMessage,
          body.name || `EMAIL_PROVIDER_HTTP_${response.status}`,
          retryable,
          response.status
        );
      }
      return { providerMessageId: body.id, responseStatus: response.status };
    } catch (error) {
      if (error instanceof EmailProviderError) throw error;
      if (controller.signal.aborted) {
        throw new EmailProviderError('O provedor de e-mail excedeu o tempo limite.', 'EMAIL_TIMEOUT', true, 408);
      }
      throw new EmailProviderError('Não foi possível conectar ao provedor de e-mail.', 'EMAIL_NETWORK_ERROR', true);
    } finally {
      clearTimeout(timer);
    }
  }
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

export function resolveEmailRequestTimeout(value: unknown): number {
  return boundedInteger(value, 6000, 1000, 10_000);
}

export function createEmailProviderFromEnv(env: NodeJS.ProcessEnv = process.env): EmailProvider {
  const provider = String(env.EMAIL_PROVIDER || 'resend').trim().toLowerCase();
  if (provider !== 'resend') {
    return {
      name: provider || 'unknown',
      ready: false,
      async send() {
        throw new EmailProviderError('Provedor de e-mail não suportado.', 'EMAIL_PROVIDER_UNSUPPORTED', false);
      }
    };
  }
  return new ResendEmailProvider({
    apiKey: String(env.RESEND_API_KEY || '').trim(),
    from: String(env.EMAIL_FROM_ADDRESS || '').trim(),
    replyTo: String(env.EMAIL_REPLY_TO || '').trim() || undefined,
    timeoutMs: resolveEmailRequestTimeout(env.EMAIL_REQUEST_TIMEOUT_MS)
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function plain(value: unknown, fallback = 'Não informado'): string {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function humanFailureReason(payload: Record<string, any>): string {
  const labels: Record<string, string> = {
    TIMEOUT: 'O site demorou mais que o limite para responder.',
    DNS_NOT_FOUND: 'O domínio não pôde ser localizado no DNS.',
    CONNECTION_REFUSED: 'O servidor recusou a conexão.',
    TLS_ERROR: 'Não foi possível estabelecer uma conexão HTTPS segura.',
    EXPECTED_CONTENT_MISSING: 'O conteúdo esperado não foi encontrado.'
  };
  const code = String(payload.reason?.technicalCode || '');
  if (labels[code]) return labels[code];
  const provided = plain(payload.reason?.human, '')
    .replace(/^(OFFLINE|CRÍTICO|CRITICAL):\s*/i, '')
    .replace(new RegExp(`\\s*\\(${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\.?$`, 'i'), '.');
  return provided || 'O site não respondeu como esperado.';
}

function technicalFailureDetail(payload: Record<string, any>): string {
  const message = String(payload.reason?.technicalMessage || '');
  const lowLevelCode = message.match(/\b(?:E[A-Z0-9_]{2,}|CERT_[A-Z0-9_]+)\b/)?.[0];
  const values = [
    lowLevelCode || payload.reason?.technicalCode,
    payload.reason?.httpStatus ? `HTTP ${payload.reason.httpStatus}` : null
  ].filter(Boolean);
  return values.join(' · ') || 'Não informado';
}

function formatTimestamp(value: unknown): string {
  const date = new Date(String(value || ''));
  if (!Number.isFinite(date.getTime())) return 'Não informado';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo'
  }).format(date);
}

function formatDuration(value: unknown): string {
  const total = Math.max(0, Math.floor(Number(value)));
  if (!Number.isFinite(total)) return 'Não disponível';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts = [hours ? `${hours}h` : '', minutes ? `${minutes}min` : '', (!hours && !minutes) ? `${seconds}s` : ''];
  return parts.filter(Boolean).join(' ');
}

function safeMonitorUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : 'https://monitoramento.tecnihub.com.br/';
  } catch {
    return 'https://monitoramento.tecnihub.com.br/';
  }
}

function emailFrame(title: string, lead: string, rows: Array<[string, string]>, monitorUrl: string): { html: string; text: string } {
  const htmlRows = rows.map(([label, value]) => `
    <tr><td style="padding:8px 12px;color:#737373;font-size:13px;vertical-align:top;width:34%">${escapeHtml(label)}</td><td style="padding:8px 12px;color:#171717;font-size:13px;vertical-align:top">${escapeHtml(value)}</td></tr>`).join('');
  const html = `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#171717"><div style="max-width:620px;margin:0 auto;padding:24px 12px"><div style="background:#0a0a0a;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0"><div style="font-size:11px;letter-spacing:1.5px;color:#a3a3a3">TECNIHUB MONITORAMENTO</div><h1 style="font-size:21px;line-height:1.3;margin:8px 0 0">${escapeHtml(title)}</h1></div><div style="background:#fff;padding:22px;border-radius:0 0 10px 10px;border:1px solid #e5e5e5;border-top:0"><p style="font-size:15px;line-height:1.55;margin:0 0 18px">${escapeHtml(lead)}</p><table role="presentation" style="border-collapse:collapse;width:100%;background:#fafafa;border:1px solid #eeeeee">${htmlRows}</table><div style="margin-top:22px"><a href="${escapeHtml(monitorUrl)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:11px 16px;border-radius:6px;font-size:13px;font-weight:bold">Ver no Monitoramento</a></div><p style="color:#8a8a8a;font-size:11px;line-height:1.5;margin:22px 0 0">Mensagem automática do TECNIHUB Monitoramento.</p></div></div></body></html>`;
  const text = [`TECNIHUB MONITORAMENTO`, '', title, lead, '', ...rows.map(([label, value]) => `${label}: ${value}`), '', `Ver no Monitoramento: ${monitorUrl}`].join('\n');
  return { html, text };
}

export function renderMonitoringEmail(
  eventType: EmailAlertEventType,
  payload: Record<string, any>,
  monitorPublicUrl: string
): Omit<EmailMessage, 'to' | 'idempotencyKey'> {
  const monitorUrl = safeMonitorUrl(monitorPublicUrl);
  if (eventType === 'email_test') {
    const test = emailFrame(
      'E-mail de teste',
      'A integração de e-mail do TECNIHUB Monitoramento está funcionando.',
      [['Horário do teste', formatTimestamp(payload.testedAt)]],
      monitorUrl
    );
    return { subject: '[TECNIHUB] E-mail de teste', ...test };
  }

  const site = payload.site || {};
  const siteName = plain(site.name, 'Site monitorado');
  if (eventType === 'incident_confirmed') {
    const technical = technicalFailureDetail(payload);
    const rendered = emailFrame(
      'SITE FORA DO AR',
      'Detectamos uma indisponibilidade confirmada no site.',
      [
        ['Cliente', plain(site.clientName)],
        ['Site', siteName],
        ['Domínio', plain(site.domain)],
        ['URL', plain(site.url)],
        ['Horário', formatTimestamp(payload.confirmedAt || payload.checkedAt)],
        ['Motivo', humanFailureReason(payload)],
        ['Detalhe técnico', technical]
      ],
      monitorUrl
    );
    return { subject: `[TECNIHUB] Site fora do ar — ${siteName}`, ...rendered };
  }

  const rendered = emailFrame(
    'SITE RESTABELECIDO',
    'O site voltou a responder normalmente.',
    [
      ['Cliente', plain(site.clientName)],
      ['Site', siteName],
      ['Domínio', plain(site.domain)],
      ['Recuperado às', formatTimestamp(payload.recoveredAt || payload.checkedAt)],
      ['Tempo de indisponibilidade', formatDuration(payload.incidentDurationSeconds)]
    ],
    monitorUrl
  );
  return { subject: `[TECNIHUB] Site restabelecido — ${siteName}`, ...rendered };
}
