import React, { useEffect, useState } from 'react';
import { Activity, Clock, Gauge, Globe2, RefreshCw } from 'lucide-react';
import { TecnihubLogo } from './TecnihubLogo';

interface PublicSiteStatus {
  name: string;
  domain: string;
  status: 'online' | 'warning' | 'critical' | 'offline' | 'unknown';
  lastCheckedAt: string | null;
  responseTimeMs: number | null;
  uptime30d: { percentage: number; reliable: boolean; sampleSize: number } | null;
}

const labels: Record<PublicSiteStatus['status'], string> = {
  online: 'Online', warning: 'Atenção necessária', critical: 'Falha crítica', offline: 'Offline', unknown: 'Status ainda não confirmado'
};

export const PublicStatusPage: React.FC = () => {
  const [sites, setSites] = useState<PublicSiteStatus[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = async () => {
    setState('loading');
    try {
      const response = await fetch('/api/public/status', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Status indisponível');
      const payload = await response.json();
      setSites(payload.sites || []);
      setGeneratedAt(payload.generatedAt || null);
      setState('ready');
    } catch {
      setState('error');
    }
  };

  useEffect(() => { void load(); }, []);
  const affected = sites.filter((site) => site.status === 'critical' || site.status === 'offline').length;
  const warnings = sites.filter((site) => site.status === 'warning').length;
  const unconfirmed = sites.filter((site) => site.status === 'unknown').length;

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-[#1e1e1e] bg-[#050505]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <TecnihubLogo size="sm" />
          <a href="/admin" className="text-[10px] font-mono text-neutral-500 hover:text-white">Área administrativa</a>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-widest text-neutral-500">Status público</p>
            <h1 className="text-2xl sm:text-3xl font-bold mt-1">Disponibilidade dos serviços</h1>
            <p className="text-xs text-neutral-400 mt-1">Dados sanitizados das verificações reais mais recentes.</p>
          </div>
          <button onClick={() => void load()} disabled={state === 'loading'} className="px-3 py-1.5 rounded border border-[#292929] bg-[#101010] text-xs flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${state === 'loading' ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>

        {state === 'error' ? (
          <div className="p-6 rounded border border-rose-900/50 bg-rose-950/20 text-sm text-rose-200">Não foi possível carregar o status agora.</div>
        ) : state === 'loading' && sites.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-neutral-500">Carregando estado dos serviços...</div>
        ) : (
          <>
            <div className={`p-4 rounded border ${affected ? 'border-rose-900/60 bg-rose-950/20' : warnings ? 'border-amber-900/60 bg-amber-950/20' : unconfirmed ? 'border-neutral-800 bg-neutral-950/20' : 'border-emerald-900/50 bg-emerald-950/15'}`}>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Activity className={`w-4 h-4 ${affected ? 'text-rose-400' : warnings ? 'text-amber-400' : 'text-emerald-400'}`} />
                {sites.length === 0 ? 'Nenhum serviço público cadastrado' : affected ? `${affected} serviço(s) com indisponibilidade` : warnings ? `${warnings} serviço(s) requerem atenção` : unconfirmed ? `${unconfirmed} serviço(s) ainda não verificado(s)` : 'Todos os serviços monitorados estão operacionais'}
              </div>
            </div>
            <div className="grid gap-2.5">
              {sites.map((site) => (
                <article key={site.domain} className="p-4 rounded bg-[#0a0a0a] border border-[#1f1f1f]">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold truncate">{site.name}</h2>
                      <span className="text-[10px] font-mono text-neutral-500 flex items-center gap-1 mt-0.5"><Globe2 className="w-3 h-3" />{site.domain}</span>
                    </div>
                    <span className={`text-[10px] font-mono font-bold uppercase px-2 py-1 rounded border ${site.status === 'online' ? 'text-emerald-400 border-emerald-900/60 bg-emerald-950/20' : site.status === 'warning' ? 'text-amber-400 border-amber-900/60 bg-amber-950/20' : site.status === 'unknown' ? 'text-neutral-400 border-neutral-800' : 'text-rose-400 border-rose-900/60 bg-rose-950/20'}`}>{labels[site.status]}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3 pt-3 border-t border-[#1b1b1b] text-[10px] font-mono">
                    <span className="text-neutral-500 flex items-center gap-1"><Clock className="w-3 h-3" />Último check: <strong className="text-neutral-300">{site.lastCheckedAt ? new Date(site.lastCheckedAt).toLocaleString('pt-BR') : 'Ainda não verificado'}</strong></span>
                    <span className="text-neutral-500 flex items-center gap-1"><Gauge className="w-3 h-3" />Resposta: <strong className="text-neutral-300">{site.responseTimeMs === null ? site.status === 'unknown' ? 'Ainda não verificado' : site.status === 'offline' || site.status === 'critical' ? 'Indisponível' : 'Não aplicável' : `${Math.round(site.responseTimeMs)} ms`}</strong></span>
                    <span className="text-neutral-500">Uptime 30d: <strong className="text-neutral-300">{site.uptime30d?.reliable ? `${Number(site.uptime30d.percentage).toFixed(2)}%` : 'Sem dados suficientes'}</strong></span>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        <p className="text-[9px] font-mono text-neutral-600 text-center">{generatedAt ? `Atualizado em ${new Date(generatedAt).toLocaleString('pt-BR')}` : 'Ainda não atualizado'}</p>
      </main>
    </div>
  );
};
