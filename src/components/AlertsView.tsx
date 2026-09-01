import React, { useEffect, useState } from 'react';
import { Bell, Check, Mail, ShieldCheck, Webhook } from 'lucide-react';
import {
  AlertWebhookConfig,
  getAlertConfiguration,
  saveAlertWebhook
} from '../services/siteService';

const eventOptions: Array<{ key: AlertWebhookConfig['event_types'][number]; label: string }> = [
  { key: 'incident_confirmed', label: 'Incidente confirmado' },
  { key: 'recovery', label: 'Recuperação confirmada' },
  { key: 'ssl_expiring', label: 'SSL perto de expirar' },
  { key: 'dns_changed', label: 'Mudança de DNS/IP' }
];

export const AlertsView: React.FC = () => {
  const [url, setUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState(5000);
  const [events, setEvents] = useState<AlertWebhookConfig['event_types']>(['incident_confirmed', 'recovery']);
  const [deliveries, setDeliveries] = useState<Array<Record<string, any>>>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    getAlertConfiguration().then((config) => {
      if (config.webhook) {
        setUrl(config.webhook.url || '');
        setEnabled(config.webhook.enabled);
        setTimeoutMs(config.webhook.timeout_ms);
        setEvents(config.webhook.event_types);
      }
      setDeliveries(config.recentDeliveries);
      setState('ready');
    }).catch((error) => {
      setMessage(error.message || 'Não foi possível carregar alertas.');
      setState('error');
    });
  }, []);

  const toggleEvent = (event: AlertWebhookConfig['event_types'][number]) => {
    setEvents((current) => current.includes(event) ? current.filter((item) => item !== event) : [...current, event]);
  };

  const save = async () => {
    setState('saving');
    setMessage('');
    try {
      const saved = await saveAlertWebhook({ url, enabled, timeoutMs, eventTypes: events });
      setUrl(saved.url);
      setEnabled(saved.enabled);
      setTimeoutMs(saved.timeout_ms);
      setEvents(saved.event_types);
      setMessage('Configuração persistida no backend.');
      setState('ready');
    } catch (error: any) {
      setMessage(error.message || 'Falha ao salvar webhook.');
      setState('error');
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="pb-1 border-b border-[#1e1e1e]">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">Alertas & Canais</h1>
        <p className="text-xs text-neutral-400 mt-0.5">Configuração persistida e tentativas reais de entrega.</p>
      </div>

      <div className="p-3.5 sm:p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-3">
        <div className="flex items-start gap-2.5">
          <div className="p-2 rounded bg-[#161616] border border-[#222] text-white"><ShieldCheck className="w-4 h-4" /></div>
          <div><h2 className="text-xs font-bold uppercase font-mono">Política anti-falso-positivo</h2><p className="text-[11px] text-neutral-400 mt-0.5">Incidente após 3 falhas de disponibilidade consecutivas; recuperação após 2 checks online. 401/403/429 e bloqueios SSRF não abrem downtime.</p></div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-3">
          <div className="flex items-center justify-between"><div className="flex items-center gap-1.5 text-xs font-semibold"><Webhook className="w-3.5 h-3.5" />Webhook</div><button onClick={() => setEnabled((value) => !value)} className={`text-[9px] font-mono px-2 py-1 rounded border ${enabled ? 'text-emerald-400 border-emerald-900' : 'text-neutral-500 border-[#292929]'}`}>{enabled ? 'Ativo' : 'Inativo'}</button></div>
          <div><label className="text-[10px] font-mono text-neutral-400">URL HTTPS pública</label><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://hooks.exemplo.com/monitor" className="mt-1 w-full px-2.5 py-1.5 bg-black border border-[#292929] rounded text-xs text-white font-mono placeholder-neutral-700" /></div>
          <div><label className="text-[10px] font-mono text-neutral-400">Timeout</label><select value={timeoutMs} onChange={(event) => setTimeoutMs(Number(event.target.value))} className="mt-1 w-full px-2.5 py-1.5 bg-black border border-[#292929] rounded text-xs text-white font-mono"><option value={3000}>3 segundos</option><option value={5000}>5 segundos</option><option value={10000}>10 segundos</option><option value={15000}>15 segundos</option></select></div>
          <div className="space-y-1.5"><span className="text-[10px] font-mono text-neutral-400">Eventos</span>{eventOptions.map((option) => <label key={option.key} className="flex items-center gap-2 text-[11px] text-neutral-300"><input type="checkbox" checked={events.includes(option.key)} onChange={() => toggleEvent(option.key)} />{option.label}</label>)}</div>
          <button onClick={() => void save()} disabled={state === 'saving' || state === 'loading'} className="px-3 py-1.5 rounded bg-white text-black text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"><Check className="w-3.5 h-3.5" />{state === 'saving' ? 'Salvando...' : 'Salvar webhook'}</button>
          {message && <p className={`text-[10px] font-mono ${state === 'error' ? 'text-rose-400' : 'text-emerald-400'}`}>{message}</p>}
        </div>

        <div className="p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-3">
          <div className="flex items-center justify-between"><div className="flex items-center gap-1.5 text-xs font-semibold"><Mail className="w-3.5 h-3.5" />E-mail</div><span className="text-[9px] font-mono px-2 py-1 rounded border border-[#292929] text-neutral-500">Não configurado</span></div>
          <p className="text-[11px] text-neutral-500">E-mail não configurado. O sistema não afirma envio enquanto não existir integração real com provedor ou SMTP.</p>
          <div className="pt-3 border-t border-[#1b1b1b]"><div className="flex items-center gap-1.5 text-xs font-semibold"><Bell className="w-3.5 h-3.5" />Últimas tentativas</div><div className="mt-2 space-y-1.5 max-h-56 overflow-auto">{deliveries.length === 0 ? <p className="text-[10px] font-mono text-neutral-600">Nenhuma tentativa registrada.</p> : deliveries.map((delivery) => <div key={delivery.id} className="p-2 rounded bg-black border border-[#1e1e1e] text-[9px] font-mono flex justify-between gap-2"><span className="text-neutral-300">{delivery.event_type}</span><span className={delivery.status === 'delivered' ? 'text-emerald-400' : delivery.status === 'failed' ? 'text-rose-400' : 'text-amber-400'}>{delivery.status}</span></div>)}</div></div>
        </div>
      </div>
    </div>
  );
};
