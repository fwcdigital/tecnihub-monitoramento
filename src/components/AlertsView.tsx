import React, { useEffect, useState } from 'react';
import { Bell, Check, Mail, RefreshCw, Send, ShieldCheck, Webhook } from 'lucide-react';
import {
  AlertDeliverySummary,
  AlertEmailConfig,
  AlertWebhookConfig,
  EmailAlertEventType,
  getAlertConfiguration,
  queueAlertEmailTest,
  saveAlertEmail,
  saveAlertWebhook
} from '../services/siteService';

const webhookEventOptions: Array<{ key: AlertWebhookConfig['event_types'][number]; label: string }> = [
  { key: 'incident_confirmed', label: 'Site fora do ar' },
  { key: 'recovery', label: 'Site restabelecido' },
  { key: 'ssl_expiring', label: 'SSL perto de expirar' },
  { key: 'dns_changed', label: 'Mudança de DNS/IP' }
];

const emailEventOptions: Array<{ key: EmailAlertEventType; label: string }> = [
  { key: 'incident_confirmed', label: 'Site fora do ar' },
  { key: 'recovery', label: 'Site restabelecido' }
];

const eventLabels: Record<string, string> = {
  incident_confirmed: 'Site fora do ar',
  recovery: 'Site restabelecido',
  ssl_expiring: 'SSL perto de expirar',
  dns_changed: 'Mudança de DNS/IP',
  email_test: 'E-mail de teste'
};

const statusLabels: Record<string, string> = {
  pending: 'Aguardando', processing: 'Enviando', delivered: 'Entregue', failed: 'Falhou'
};

function parseRecipients(value: string): string[] {
  return [...new Set(value.split(/[\n,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

export const AlertsView: React.FC = () => {
  const [url, setUrl] = useState('');
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState(5000);
  const [webhookEvents, setWebhookEvents] = useState<AlertWebhookConfig['event_types']>(['incident_confirmed', 'recovery']);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [recipientsText, setRecipientsText] = useState('');
  const [emailEvents, setEmailEvents] = useState<EmailAlertEventType[]>(['incident_confirmed', 'recovery']);
  const [providerReady, setProviderReady] = useState(false);
  const [providerName, setProviderName] = useState('resend');
  const [providerLabel, setProviderLabel] = useState('Verificando provedor...');
  const [deliveries, setDeliveries] = useState<AlertDeliverySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'webhook' | 'email' | 'test' | null>(null);
  const [webhookMessage, setWebhookMessage] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [loadError, setLoadError] = useState('');

  const applyEmailConfig = (email: AlertEmailConfig) => {
    setEmailEnabled(email.enabled);
    setRecipientsText(email.recipients.join('\n'));
    setEmailEvents(email.event_types);
    setProviderReady(email.providerReady);
    setProviderName(email.provider || 'resend');
    setProviderLabel(email.label);
  };

  const load = async () => {
    const config = await getAlertConfiguration();
    if (config.webhook) {
      setUrl(config.webhook.url || '');
      setWebhookEnabled(config.webhook.enabled);
      setTimeoutMs(config.webhook.timeout_ms);
      setWebhookEvents(config.webhook.event_types);
    }
    applyEmailConfig(config.email);
    setDeliveries(config.recentDeliveries);
  };

  useEffect(() => {
    load().catch((error) => setLoadError(error.message || 'Não foi possível carregar alertas.'))
      .finally(() => setLoading(false));
  }, []);

  const toggleWebhookEvent = (event: AlertWebhookConfig['event_types'][number]) => {
    setWebhookEvents((current) => current.includes(event) ? current.filter((item) => item !== event) : [...current, event]);
  };

  const toggleEmailEvent = (event: EmailAlertEventType) => {
    setEmailEvents((current) => current.includes(event) ? current.filter((item) => item !== event) : [...current, event]);
  };

  const saveWebhook = async () => {
    setSaving('webhook');
    setWebhookMessage('');
    try {
      const saved = await saveAlertWebhook({ url, enabled: webhookEnabled, timeoutMs, eventTypes: webhookEvents });
      setUrl(saved.url);
      setWebhookEnabled(saved.enabled);
      setTimeoutMs(saved.timeout_ms);
      setWebhookEvents(saved.event_types);
      setWebhookMessage('Webhook salvo com segurança.');
    } catch (error: any) {
      setWebhookMessage(error.message || 'Falha ao salvar webhook.');
    } finally {
      setSaving(null);
    }
  };

  const saveEmail = async () => {
    setSaving('email');
    setEmailMessage('');
    try {
      const saved = await saveAlertEmail({
        enabled: emailEnabled,
        recipients: parseRecipients(recipientsText),
        eventTypes: emailEvents
      });
      applyEmailConfig({ ...saved, label: saved.enabled ? 'E-mail ativo' : 'Provedor pronto' });
      setEmailMessage('Configuração de e-mail salva.');
    } catch (error: any) {
      setEmailMessage(error.message || 'Falha ao salvar configuração de e-mail.');
    } finally {
      setSaving(null);
    }
  };

  const sendTest = async () => {
    setSaving('test');
    setEmailMessage('');
    try {
      const saved = await saveAlertEmail({
        enabled: emailEnabled,
        recipients: parseRecipients(recipientsText),
        eventTypes: emailEvents
      });
      applyEmailConfig({ ...saved, label: saved.enabled ? 'E-mail ativo' : 'Provedor pronto' });
      const result = await queueAlertEmailTest();
      setEmailMessage(result.message);
      await load();
    } catch (error: any) {
      setEmailMessage(error.message || 'Falha ao colocar o teste na fila.');
    } finally {
      setSaving(null);
    }
  };

  const deliveryStatusClass = (delivery: AlertDeliverySummary) => delivery.status === 'delivered'
    ? 'text-emerald-400'
    : delivery.status === 'failed' ? 'text-rose-400' : 'text-amber-400';

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="pb-1 border-b border-[#1e1e1e]">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">Alertas & Notificações</h1>
        <p className="text-xs text-neutral-400 mt-0.5">Canais persistentes, tentativas controladas e histórico real de entrega.</p>
      </div>

      <div className="p-3.5 sm:p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-3">
        <div className="flex items-start gap-2.5">
          <div className="p-2 rounded bg-[#161616] border border-[#222] text-white"><ShieldCheck className="w-4 h-4" /></div>
          <div><h2 className="text-xs font-bold uppercase font-mono">Política anti-falso-positivo</h2><p className="text-[11px] text-neutral-400 mt-0.5">Incidente após 3 falhas consecutivas; recuperação após 2 checks online. Os canais usam essas mesmas transições e não notificam cada check isolado.</p></div>
        </div>
      </div>

      {loadError && <div className="p-3 rounded border border-rose-950 bg-rose-950/20 text-xs text-rose-400">{loadError}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-3">
          <div className="flex items-center justify-between"><div className="flex items-center gap-1.5 text-xs font-semibold"><Webhook className="w-3.5 h-3.5" />Webhook</div><button onClick={() => setWebhookEnabled((value) => !value)} className={`text-[9px] font-mono px-2 py-1 rounded border ${webhookEnabled ? 'text-emerald-400 border-emerald-900' : 'text-neutral-500 border-[#292929]'}`}>{webhookEnabled ? 'Ativo' : 'Inativo'}</button></div>
          <div><label className="text-[10px] font-mono text-neutral-400">URL HTTPS pública</label><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://hooks.exemplo.com/monitor" className="mt-1 w-full px-2.5 py-1.5 bg-black border border-[#292929] rounded text-xs text-white font-mono placeholder-neutral-700" /></div>
          <div><label className="text-[10px] font-mono text-neutral-400">Timeout</label><select value={timeoutMs} onChange={(event) => setTimeoutMs(Number(event.target.value))} className="mt-1 w-full px-2.5 py-1.5 bg-black border border-[#292929] rounded text-xs text-white font-mono"><option value={3000}>3 segundos</option><option value={5000}>5 segundos</option><option value={10000}>10 segundos</option><option value={15000}>15 segundos</option></select></div>
          <div className="space-y-1.5"><span className="text-[10px] font-mono text-neutral-400">Eventos</span>{webhookEventOptions.map((option) => <label key={option.key} className="flex items-center gap-2 text-[11px] text-neutral-300"><input type="checkbox" checked={webhookEvents.includes(option.key)} onChange={() => toggleWebhookEvent(option.key)} />{option.label}</label>)}</div>
          <button onClick={() => void saveWebhook()} disabled={Boolean(saving) || loading} className="px-3 py-1.5 rounded bg-white text-black text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"><Check className="w-3.5 h-3.5" />{saving === 'webhook' ? 'Salvando...' : 'Salvar webhook'}</button>
          {webhookMessage && <p className="text-[10px] font-mono text-neutral-300">{webhookMessage}</p>}
        </div>

        <div className="p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-3">
          <div className="flex items-center justify-between"><div className="flex items-center gap-1.5 text-xs font-semibold"><Mail className="w-3.5 h-3.5" />E-mail</div><span className={`text-[9px] font-mono px-2 py-1 rounded border ${providerReady ? emailEnabled ? 'text-emerald-400 border-emerald-900' : 'text-sky-400 border-sky-950' : 'text-rose-400 border-rose-950'}`}>{providerLabel}</span></div>
          <div className="p-2.5 rounded bg-black border border-[#1e1e1e]"><p className="text-[10px] font-mono text-neutral-400">Provedor</p><p className="text-xs text-white mt-0.5 capitalize">{providerName} · {providerReady ? 'credenciais disponíveis no servidor' : 'aguardando configuração na Hostinger'}</p></div>
          <button disabled={!providerReady} onClick={() => setEmailEnabled((value) => !value)} className={`w-full text-left text-[11px] px-2.5 py-2 rounded border disabled:opacity-40 ${emailEnabled ? 'text-emerald-400 border-emerald-950 bg-emerald-950/10' : 'text-neutral-400 border-[#292929]'}`}>{emailEnabled ? '✓ Notificações por e-mail ativadas' : 'Ativar notificações por e-mail'}</button>
          <div><label className="text-[10px] font-mono text-neutral-400">Destinatários</label><textarea rows={4} value={recipientsText} onChange={(event) => setRecipientsText(event.target.value)} placeholder={'operacao@empresa.com\nresponsavel@empresa.com'} className="mt-1 w-full px-2.5 py-2 bg-black border border-[#292929] rounded text-xs text-white font-mono placeholder-neutral-700 resize-none" /><p className="text-[9px] text-neutral-600 mt-1">Um por linha, ou separados por vírgula. Máximo de 50.</p></div>
          <div className="space-y-1.5"><span className="text-[10px] font-mono text-neutral-400">Eventos</span>{emailEventOptions.map((option) => <label key={option.key} className="flex items-center gap-2 text-[11px] text-neutral-300"><input type="checkbox" checked={emailEvents.includes(option.key)} onChange={() => toggleEmailEvent(option.key)} />{option.label}</label>)}</div>
          <div className="flex flex-wrap gap-2"><button onClick={() => void saveEmail()} disabled={Boolean(saving) || loading} className="px-3 py-1.5 rounded bg-white text-black text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"><Check className="w-3.5 h-3.5" />{saving === 'email' ? 'Salvando...' : 'Salvar e-mail'}</button><button onClick={() => void sendTest()} disabled={Boolean(saving) || loading || !providerReady || parseRecipients(recipientsText).length === 0} className="px-3 py-1.5 rounded border border-[#333] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40"><Send className="w-3.5 h-3.5" />{saving === 'test' ? 'Enfileirando...' : 'Enviar e-mail de teste'}</button></div>
          {emailMessage && <p className="text-[10px] font-mono text-neutral-300">{emailMessage}</p>}
        </div>
      </div>

      <div className="p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e]">
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1.5 text-xs font-semibold"><Bell className="w-3.5 h-3.5" />Histórico de entregas</div><button onClick={() => void load()} className="text-neutral-500 hover:text-white" title="Atualizar histórico"><RefreshCw className="w-3.5 h-3.5" /></button></div>
        <div className="mt-3 space-y-1.5 max-h-80 overflow-auto">{deliveries.length === 0 ? <p className="text-[10px] font-mono text-neutral-600">Nenhuma tentativa registrada.</p> : deliveries.map((delivery) => <div key={delivery.id} className="p-2.5 rounded bg-black border border-[#1e1e1e] text-[10px] font-mono"><div className="flex flex-wrap justify-between gap-2"><span className="text-neutral-300">{delivery.channel === 'email' ? 'E-mail' : 'Webhook'} · {eventLabels[delivery.event_type] || delivery.event_type}</span><span className={deliveryStatusClass(delivery)}>{statusLabels[delivery.status] || delivery.status}</span></div><div className="mt-1 text-neutral-600 flex flex-wrap gap-x-3"><span>Tentativa {delivery.attempt_count}</span>{delivery.recipient && <span>{delivery.recipient}</span>}<span>{new Date(delivery.created_at).toLocaleString('pt-BR')}</span></div>{delivery.error_message && <p className="mt-1.5 text-rose-400 normal-case font-sans text-[11px]">{delivery.error_message}{delivery.status === 'pending' && delivery.next_attempt_at ? ` Nova tentativa: ${new Date(delivery.next_attempt_at).toLocaleString('pt-BR')}.` : ''}</p>}</div>)}</div>
      </div>
    </div>
  );
};
