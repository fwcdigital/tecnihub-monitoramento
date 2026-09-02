import React, { useEffect, useState } from 'react';
import { 
  ArrowLeft, 
  Globe, 
  RefreshCw, 
  ExternalLink, 
  ShieldCheck, 
  ShieldAlert, 
  Server, 
  Clock, 
  AlertOctagon, 
  AlertTriangle, 
  CheckCircle2, 
  Edit3, 
  PauseCircle, 
  PlayCircle, 
  Check, 
  Lock,
  Search,
  Activity,
  Layers,
  Tag,
  CheckCircle,
  XCircle,
  AlertCircle
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  BarChart, 
  Bar 
} from 'recharts';
import { Site, CheckRecord, MonitoringSeriesPoint, SiteMetrics } from '../types';
import { getSiteChecksPage, getSiteMonitoringMetrics } from '../services/siteService';
import { domainUnavailableLabel, responseTimeUnavailableLabel, siteStatusLabel, sslUnavailableLabel } from '../utils/diagnosticLabels';
import { SiteTechnicalAccesses } from './AccessesView';

interface SiteDetailViewProps {
  site: Site;
  onBack: () => void;
  onCheckNow: (siteId: string) => void;
  onEdit: (site: Site) => void;
  onTogglePause: (siteId: string) => void;
  isChecking?: boolean;
  notify: (type: 'success' | 'error' | 'info' | 'warning', title: string, message?: string) => void;
}

export const SiteDetailView: React.FC<SiteDetailViewProps> = ({
  site,
  onBack,
  onCheckNow,
  onEdit,
  onTogglePause,
  isChecking = false,
  notify
}) => {
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d' | '90d'>('24h');
  const [history, setHistory] = useState<CheckRecord[]>(site.checksHistory);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [series, setSeries] = useState<MonitoringSeriesPoint[]>([]);
  const [metrics, setMetrics] = useState<SiteMetrics>(site.metrics || {});
  const [detailLoading, setDetailLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getSiteChecksPage(site.id)
      .then((historyPage) => {
        if (!active) return;
        setHistory(historyPage.checks);
        setNextCursor(historyPage.nextCursor);
        setHasMoreHistory(historyPage.hasMore);
      }).catch(() => { if (active) setHistory([]); });
    return () => { active = false; };
  }, [site.id, site.updatedAt]);

  useEffect(() => {
    let active = true;
    setDetailLoading(true);
    getSiteMonitoringMetrics(site.id, timeRange).then((monitoring) => {
      if (!active) return;
      setSeries(monitoring.series);
      setMetrics(monitoring.metrics);
    }).catch(() => setSeries([])).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [site.id, site.updatedAt, timeRange]);

  // The chart is built only from persisted checks returned by the API.
  const latencyData = React.useMemo(() => {
    const days = timeRange === '24h' ? 1 : timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
    return series.filter((point) => point.avg_response_ms !== null).map((point) => ({
        time: new Date(point.bucket).toLocaleString('pt-BR', {
          day: days > 1 ? '2-digit' : undefined, month: days > 1 ? '2-digit' : undefined,
          hour: '2-digit',
          minute: '2-digit'
        }),
        responseTime: Number(point.avg_response_ms) / 1000
      }));
  }, [timeRange, series]);

  const uptimeBlocks = React.useMemo(
    () => series.filter((point) => Number(point.total_checks) > 0).map((point, index) => ({
      id: `${point.bucket}-${index}`,
      timestamp: new Date(point.bucket).toLocaleString('pt-BR'),
      checkedAt: point.bucket,
      status: Number(point.available_checks) === Number(point.total_checks) ? 'online' as const
        : Number(point.available_checks) > 0 ? 'warning' as const : 'offline' as const,
      httpCode: 'Agregado', responseTime: Number(point.avg_response_ms || 0) / 1000,
      result: `${point.available_checks}/${point.total_checks} checks disponíveis`
    })),
    [series]
  );

  const selectedMetric = metrics[timeRange];

  const isPaused = site.status === 'paused';
  const diagnosticUnavailable = site.status === 'unknown' ? 'Ainda não verificado' : 'Falha na verificação';

  return (
    <div className="space-y-4 sm:space-y-5">
      
      {/* Top Breadcrumb & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-[#1e1e1e]">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onBack}
            className="p-1.5 text-neutral-400 hover:text-white rounded bg-[#111111] border border-[#222222] hover:bg-[#1a1a1a] transition-colors"
            title="Voltar ao Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono uppercase font-bold text-neutral-400 tracking-wider">
                {site.client}
              </span>
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#161616] text-neutral-400 border border-[#222222]">
                {site.hosting}
              </span>
            </div>
            <h1 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2 mt-0.5">
              {site.siteName}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={site.url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1.5 text-xs font-medium text-neutral-300 bg-[#111111] hover:bg-[#1a1a1a] border border-[#222222] rounded transition-colors flex items-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Abrir URL
          </a>

          <button
            onClick={() => onEdit(site)}
            className="px-2.5 py-1.5 text-xs font-medium text-neutral-300 bg-[#111111] hover:bg-[#1a1a1a] border border-[#222222] rounded transition-colors flex items-center gap-1.5"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Editar
          </button>

          <button
            onClick={() => onTogglePause(site.id)}
            className="px-2.5 py-1.5 text-xs font-medium text-neutral-300 bg-[#111111] hover:bg-[#1a1a1a] border border-[#222222] rounded transition-colors flex items-center gap-1.5"
          >
            {isPaused ? (
              <>
                <PlayCircle className="w-3.5 h-3.5 text-emerald-400" />
                Reativar monitoramento
              </>
            ) : (
              <>
                <PauseCircle className="w-3.5 h-3.5 text-amber-400" />
                Desativar monitoramento
              </>
            )}
          </button>

          <button
            onClick={() => onCheckNow(site.id)}
            disabled={isChecking}
            className="px-3 py-1.5 text-xs font-semibold bg-white text-black hover:bg-neutral-200 rounded transition-colors shadow-xs flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
            {isChecking ? 'Verificando...' : 'Verificar agora'}
          </button>
        </div>
      </div>

      {/* Main Status Header Bar */}
      <div className="p-3.5 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded ${
            site.status === 'online'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : (site.status === 'warning' || site.status === 'security_blocked')
              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              : site.status === 'offline' || site.status === 'critical'
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              : 'bg-[#161616] text-neutral-400'
          }`}>
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-white">
                {site.domain}
              </span>
              <span className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded uppercase flex items-center gap-1.5 ${
                site.status === 'online'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : (site.status === 'warning' || site.status === 'security_blocked')
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : site.status === 'offline' || site.status === 'critical'
                  ? 'bg-rose-500 text-white font-bold'
                  : 'bg-[#161616] text-neutral-400 border border-[#222222]'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  site.status === 'online' ? 'bg-emerald-400' :
                  site.status === 'warning' || site.status === 'security_blocked' ? 'bg-amber-400' :
                  site.status === 'offline' || site.status === 'critical' ? 'bg-white animate-pulse' : 'bg-neutral-500'
                }`} />
                {site.status === 'online' ? 'ONLINE' : site.status === 'security_blocked' ? 'BLOQUEADO POR SEGURANÇA' : site.status === 'warning' ? 'ATENÇÃO' : site.status === 'critical' ? 'CRÍTICO' : site.status === 'offline' ? 'OFFLINE' : site.status === 'paused' ? 'PAUSADO' : 'SEM DADOS'}
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 mt-0.5 font-mono">
              Última verificação: <strong className="text-neutral-200">{site.lastCheck}</strong> • Frequência: <strong className="text-neutral-200">{site.frequency}</strong>
            </p>
          </div>
        </div>

        {(site.status === 'offline' || site.status === 'critical') && (
          <div className="px-2.5 py-1 rounded bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-mono">
            {history[0]?.result || (site.status === 'critical' ? 'Falha crítica na verificação' : 'Falha na conexão')}
          </div>
        )}
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-2.5">
        
        {/* STATUS */}
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase text-neutral-400 font-semibold">
            Status
          </span>
          <div className="mt-1.5">
            <span className={`text-base font-bold font-mono uppercase ${
              site.status === 'online' ? 'text-emerald-400' :
              site.status === 'warning' || site.status === 'security_blocked' ? 'text-amber-400' :
              site.status === 'offline' || site.status === 'critical' ? 'text-rose-400' : 'text-neutral-400'
            }`}>
              {siteStatusLabel(site.status)}
            </span>
          </div>
        </div>

        {/* UPTIME — 30 DIAS */}
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase text-neutral-400 font-semibold">
            Uptime — 30d
          </span>
          <div className="mt-1.5">
            <span className="text-xl font-bold font-mono text-white">
              {site.uptime30d === null ? 'Sem dados suficientes' : site.uptime30dReliable ? `${site.uptime30d.toFixed(2)}%` : `Parcial (${site.uptime30d.toFixed(2)}%)`}
            </span>
          </div>
        </div>

        {/* TEMPO DE RESPOSTA */}
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase text-neutral-400 font-semibold">
            Resposta
          </span>
          <div className="mt-1.5">
            <span className="text-xl font-bold font-mono text-white">
              {site.responseTime === null ? responseTimeUnavailableLabel(site) : `${site.responseTime.toFixed(2)}s`}
            </span>
          </div>
        </div>

        {/* SSL */}
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase text-neutral-400 font-semibold">
            Certificado SSL
          </span>
          <div className="mt-1.5">
            <span className={`text-xs font-bold font-mono block ${
              site.sslDaysRemaining !== null && site.sslDaysRemaining <= 15 ? 'text-amber-400' : 'text-neutral-400'
            }`}>
              {site.sslValid === null ? sslUnavailableLabel(site) : site.sslValid ? 'Válido' : 'Inválido'}
            </span>
            <span className="text-[10px] font-mono text-neutral-400">
              {site.sslDaysRemaining === null ? sslUnavailableLabel(site) : `${site.sslDaysRemaining}d restantes`}
            </span>
          </div>
        </div>

        {/* DOMÍNIO */}
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase text-neutral-400 font-semibold">
            Domínio
          </span>
          <div className="mt-1.5">
            <span className="text-xl font-bold font-mono text-white block">
              {site.domainDaysRemaining === null ? domainUnavailableLabel(site) : `${site.domainDaysRemaining}d`}
            </span>
            <span className="text-[10px] font-mono text-neutral-400">
              {site.domainDaysRemaining === null ? domainUnavailableLabel(site) : 'restantes'}
            </span>
          </div>
        </div>

        {/* HTTP */}
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase text-neutral-400 font-semibold">
            Código HTTP
          </span>
          <div className="mt-1.5">
            <span className={`text-xl font-bold font-mono ${
              site.httpStatus === 200 ? 'text-emerald-400' :
              site.httpStatus === 503 || site.httpStatus === 500 ? 'text-rose-400 font-black' : 'text-neutral-300'
            }`}>
              {site.httpStatus === null ? 'Ainda não verificado' : site.httpStatus === 200 ? '200 OK' : site.httpStatus}
            </span>
          </div>
        </div>
      </div>

      {/* Availability Heat Blocks (90 days history view) */}
      <div className="p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-2.5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-neutral-300">
              Histórico de Disponibilidade Operacional
            </h3>
            <p className="text-[10px] text-neutral-500 mt-0.5">
              Cada bloco representa um período agregado a partir de checks persistidos ({timeRange})
            </p>
          </div>
          <span className="text-xs font-mono font-bold text-emerald-400">
            {!selectedMetric?.totalChecks ? 'Sem dados suficientes' : `${Number(selectedMetric.uptimePercent).toFixed(2)}% de disponibilidade`}
          </span>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto py-1">
          {uptimeBlocks.map((check, idx) => {
            const bg = {
              online: 'bg-emerald-500/80 hover:bg-emerald-400',
              warning: 'bg-amber-500/90 hover:bg-amber-400',
              offline: 'bg-rose-500 hover:bg-rose-400',
              critical: 'bg-rose-500 hover:bg-rose-400'
            }[check.status];

            return (
              <div
                key={idx}
                title={`${check.timestamp}: ${siteStatusLabel(check.status)}`}
                className={`h-6 flex-1 min-w-[5px] rounded-xs transition-colors cursor-pointer ${bg}`}
              />
            );
          })}
          {uptimeBlocks.length === 0 && (
            <span className="text-xs font-mono text-neutral-500">Sem dados suficientes.</span>
          )}
        </div>

        <div className="flex items-center justify-between text-[9px] font-mono text-neutral-500 pt-0.5">
          <span>Início do período</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-xs bg-emerald-500" /> Operacional
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-xs bg-amber-500" /> Instabilidade
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-xs bg-rose-500" /> Indisponível
            </span>
          </span>
          <span>Hoje</span>
        </div>
      </div>

      {/* Response Time Chart (Recharts) */}
      <div className="p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-neutral-300">
              Evolução do Tempo de Resposta (Latência)
            </h3>
            <p className="text-[10px] text-neutral-500 mt-0.5">
              Tempo de carregamento e resposta em segundos
            </p>
          </div>

          {/* Time range filters */}
          <div className="flex items-center gap-1 p-0.5 rounded bg-[#000000] border border-[#1e1e1e] text-[11px]">
            {(['24h', '7d', '30d', '90d'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-2 py-0.5 rounded font-mono font-medium transition-colors ${
                  timeRange === r
                    ? 'bg-[#222222] text-white font-bold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="h-56 w-full pt-1">
          {latencyData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs font-mono text-neutral-500">
              {detailLoading ? 'Carregando medições reais...' : 'Sem dados suficientes no período selecionado.'}
            </div>
          ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={latencyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ffffff" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#ffffff" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1c1c1c" vertical={false} />
              <XAxis dataKey="time" stroke="#666666" fontSize={10} tickLine={false} />
              <YAxis stroke="#666666" fontSize={10} tickLine={false} unit="s" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0a0a0a',
                  borderColor: '#262626',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '11px',
                  fontFamily: 'JetBrains Mono'
                }}
                formatter={(value: any) => [`${value}s`, 'Tempo de resposta']}
              />
              <Area
                type="monotone"
                dataKey="responseTime"
                stroke="#ffffff"
                strokeWidth={1.5}
                fillOpacity={1}
                fill="url(#latencyGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[#181818]">
          {[
            { label: 'Atual', value: site.responseTime === null ? null : site.responseTime * 1000 },
            { label: `Média ${timeRange}`, value: selectedMetric?.avgResponseMs },
            { label: 'Mínimo', value: selectedMetric?.minResponseMs },
            { label: 'Máximo', value: selectedMetric?.maxResponseMs }
          ].map((metric) => <div key={metric.label} className="p-2 rounded bg-black border border-[#1e1e1e]"><span className="text-[9px] font-mono text-neutral-500 uppercase">{metric.label}</span><strong className="text-xs font-mono text-neutral-200 block mt-0.5">{metric.value === null || metric.value === undefined ? 'Sem dados suficientes' : `${Math.round(Number(metric.value))} ms`}</strong></div>)}
        </div>
        {selectedMetric?.totalChecks ? <p className="text-[9px] font-mono text-neutral-600">{selectedMetric.hasFullWindow ? 'Janela histórica completa.' : 'Histórico parcial; a janela selecionada ainda não está totalmente coberta.'} {selectedMetric.totalChecks} checks elegíveis.</p> : null}
      </div>

      {/* Rastreamento — Tags e Ferramentas Monitoradas */}
      <div className="p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-[#181818]">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-white flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-neutral-400" />
                Rastreamento
              </h3>
            </div>
            <p className="text-[10px] text-neutral-400 mt-0.5 font-mono">
              Última análise HTML: <strong className="text-neutral-200">{site.tracking?.lastCheckedAt ? new Date(site.tracking.lastCheckedAt).toLocaleString('pt-BR') : 'Ainda não verificado'}</strong>. Detecção não confirma funcionamento da tag.
            </p>
          </div>

          <button
            disabled
            className="px-3 py-1.5 text-xs font-medium text-neutral-200 bg-[#111111] hover:bg-[#1a1a1a] hover:text-white border border-[#222222] rounded transition-colors flex items-center gap-1.5 disabled:opacity-50 self-start sm:self-auto"
            title="Realizar novamente a análise de tags e integrações"
          >
            <RefreshCw className="w-3.5 h-3.5 text-neutral-500" />
            Verificação indisponível
          </button>
        </div>

        {/* High-density grid of the 5 core tracking tools */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          {[
            { key: 'ga4', title: 'Google Analytics' },
            { key: 'gtm', title: 'Google Tag Manager' },
            { key: 'googleAds', title: 'Google Ads' },
            { key: 'metaPixel', title: 'Meta Pixel' },
            { key: 'searchConsole', title: 'Google Search Console' }
          ].map(({ key, title }) => {
            const toolRes = site.tracking?.results?.[key as keyof typeof site.tracking.results];
            const toolConfig = site.tracking?.[key as 'ga4' | 'gtm' | 'googleAds' | 'metaPixel' | 'searchConsole'];
            const status = toolRes?.status || 'gray';
            const statusLabel = toolRes?.statusLabel || (toolConfig?.enabled ? 'Ainda não verificado' : 'Não configurado');
            const displayId = toolRes?.foundId || toolRes?.expectedId || toolConfig?.expectedId;

            return (
              <div
                key={key}
                className={`p-3 rounded border flex flex-col justify-between transition-colors ${
                  status === 'green'
                    ? 'bg-[#000000] border-[#1e1e1e]'
                    : status === 'yellow'
                    ? 'bg-amber-950/15 border-amber-900/40'
                    : status === 'red'
                    ? 'bg-rose-950/20 border-rose-900/40'
                    : 'bg-[#000000] border-[#181818]'
                }`}
              >
                <div>
                  <span className="text-xs font-semibold text-neutral-200 block truncate">
                    {title}
                  </span>

                  {/* Status indicator with dot */}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        status === 'green'
                          ? 'bg-emerald-400'
                          : status === 'yellow'
                          ? 'bg-amber-400'
                          : status === 'red'
                          ? 'bg-rose-500 animate-pulse'
                          : 'bg-neutral-600'
                      }`}
                    />
                    <span
                      className={`text-[11px] font-mono font-medium ${
                        status === 'green'
                          ? 'text-emerald-400'
                          : status === 'yellow'
                          ? 'text-amber-400 font-bold'
                          : status === 'red'
                          ? 'text-rose-400 font-bold'
                          : 'text-neutral-500'
                      }`}
                    >
                      {statusLabel}
                    </span>
                  </div>
                </div>

                {/* ID or Status Details */}
                <div className="mt-2 pt-1.5 border-t border-[#161616]">
                  {key === 'searchConsole' ? (
                    <span className="text-[10px] font-mono text-neutral-400 block truncate">
                      {toolConfig?.enabled ? 'Configurado; ainda não verificado' : 'Não configurado'}
                    </span>
                  ) : status === 'gray' ? (
                    <span className="text-[10px] font-mono text-neutral-600 block">
                      {toolConfig?.enabled ? (displayId || 'Configurado sem ID') : 'Não configurado'}
                    </span>
                  ) : status === 'yellow' && toolRes?.foundId && toolRes.expectedId && toolRes.foundId !== toolRes.expectedId ? (
                    <div className="space-y-0.5">
                      <span className="text-[9px] font-mono text-amber-300 block truncate" title={`Detectado: ${toolRes.foundId}`}>
                        {toolRes.foundId}
                      </span>
                      <span className="text-[9px] font-mono text-neutral-500 block truncate" title={`Esperado: ${toolRes.expectedId}`}>
                        Exp: {toolRes.expectedId}
                      </span>
                    </div>
                  ) : displayId ? (
                    <span
                      className={`text-[11px] font-mono block truncate ${
                        status === 'red' ? 'text-rose-400/80 line-through' : 'text-neutral-300'
                      }`}
                      title={displayId}
                    >
                      {displayId}
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-neutral-500 block">
                      -
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Monitoring Config & Content Verification Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3.5 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-2.5">
          <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-neutral-300">
            Regras de Verificação Ativas
          </h3>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-2 rounded bg-[#000000] border border-[#1e1e1e] flex items-center justify-between">
              <span className="text-neutral-400">Disponibilidade:</span>
              <span className="text-emerald-400 font-mono font-medium">Ativa</span>
            </div>
            <div className="p-2 rounded bg-[#000000] border border-[#1e1e1e] flex items-center justify-between">
              <span className="text-neutral-400">Tempo de resposta:</span>
              <span className="text-emerald-400 font-mono font-medium">{site.monitorResponseTime ? 'Configurado' : 'Não configurado'}</span>
            </div>
            <div className="p-2 rounded bg-[#000000] border border-[#1e1e1e] flex items-center justify-between">
              <span className="text-neutral-400">Certificado SSL:</span>
              <span className="text-neutral-300 font-mono font-medium">{site.sslValid === null ? sslUnavailableLabel(site) : site.sslValid ? `Válido (${site.sslDaysRemaining}d)` : 'Inválido'}</span>
            </div>
            <div className="p-2 rounded bg-[#000000] border border-[#1e1e1e] flex items-center justify-between">
              <span className="text-neutral-400">Domínio RDAP:</span>
              <span className="text-neutral-300 font-mono font-medium">{site.domainInfo?.status === 'available' ? `${site.domainDaysRemaining ?? '—'}d` : domainUnavailableLabel(site)}</span>
            </div>
          </div>
        </div>

        <div className="p-3.5 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-2.5">
          <h3 className="text-xs font-bold uppercase tracking-wider font-mono text-neutral-300">
            Verificação de Conteúdo da Página
          </h3>
          {site.monitorContent && site.expectedContentText ? (
            <div className="space-y-1.5">
              <p className="text-[11px] text-neutral-400">
                Texto procurado no HTML real da última resposta:
              </p>
              <div className="p-2 rounded bg-[#000000] border border-[#1e1e1e] font-mono text-xs text-neutral-300 flex items-center justify-between">
                <span>"{site.expectedContentText}"</span>
                <span className={`text-[9px] px-1.5 py-0.2 rounded bg-[#161616] ${history[0]?.expectedContentFound === true ? 'text-emerald-400' : history[0]?.expectedContentFound === false ? 'text-rose-400' : 'text-neutral-400'}`}>
                  {history[0]?.expectedContentFound === true ? 'Encontrado' : history[0]?.expectedContentFound === false ? 'Não encontrado' : history.length === 0 ? 'Ainda não verificado' : 'Falha na verificação'}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-neutral-500 py-1 font-mono">
              Não configurado para este site.
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] text-[10px] font-mono space-y-1">
          <strong className="text-neutral-300 uppercase">DNS / IP real</strong>
          <p className="text-neutral-500">IP observado: <span className="text-neutral-300">{site.dns?.observedIp || history[0]?.observedIp || diagnosticUnavailable}</span></p>
          <p className="text-neutral-500">A: <span className="text-neutral-300">{site.dns?.a?.join(', ') || diagnosticUnavailable}</span></p>
          <p className="text-neutral-500">AAAA: <span className="text-neutral-300">{site.dns?.aaaa?.join(', ') || diagnosticUnavailable}</span></p>
          <p className="text-neutral-500">CNAME: <span className="text-neutral-300">{site.dns?.cname?.join(', ') || diagnosticUnavailable}</span></p>
        </div>
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] text-[10px] font-mono space-y-1">
          <strong className="text-neutral-300 uppercase">Certificado TLS</strong>
          <p className="text-neutral-500">Hostname: <span className="text-neutral-300">{site.ssl?.hostnameValid === true ? 'Válido' : site.ssl?.hostnameValid === false ? 'Inválido' : sslUnavailableLabel(site)}</span></p>
          <p className="text-neutral-500">Emissor: <span className="text-neutral-300">{site.ssl?.issuer || sslUnavailableLabel(site)}</span></p>
          <p className="text-neutral-500">Válido de: <span className="text-neutral-300">{site.ssl?.validFrom ? new Date(site.ssl.validFrom).toLocaleDateString('pt-BR') : sslUnavailableLabel(site)}</span></p>
          <p className="text-neutral-500">Válido até: <span className="text-neutral-300">{site.ssl?.validTo ? new Date(site.ssl.validTo).toLocaleDateString('pt-BR') : sslUnavailableLabel(site)}</span></p>
        </div>
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] text-[10px] font-mono space-y-1">
          <strong className="text-neutral-300 uppercase">Domínio / WordPress</strong>
          <p className="text-neutral-500">Registrador: <span className="text-neutral-300">{site.domainInfo?.registrar || domainUnavailableLabel(site)}</span></p>
          <p className="text-neutral-500">Expiração: <span className="text-neutral-300">{site.domainInfo?.expiresAt || site.domainInfo?.expires_at_registry ? new Date(site.domainInfo.expiresAt || site.domainInfo.expires_at_registry).toLocaleDateString('pt-BR') : domainUnavailableLabel(site)}</span></p>
          <p className="text-neutral-500">WordPress: <span className="text-neutral-300">{site.wordpress?.detected ? 'Detectado' : site.isWordPress ? 'Configurado; sem evidência na última verificação' : 'Não configurado'}</span></p>
          <p className="text-neutral-500">Admin básico: <span className="text-neutral-300">{site.wordpress?.administrativeAvailable === true ? 'Acessível/protegido' : site.wordpress?.administrativeAvailable === false ? 'Indisponível' : 'Não aplicável'}</span></p>
        </div>
      </div>

      <SiteTechnicalAccesses site={site} notify={notify} />

      {/* Tabela: Últimas Verificações - High Density */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-white tracking-tight uppercase font-mono">
            Últimas verificações
          </h3>
          <span className="text-[10px] font-mono text-neutral-500">
            Checks registrados
          </span>
        </div>

        <div className="rounded border border-[#1e1e1e] bg-[#0a0a0a] overflow-hidden shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#1e1e1e] bg-[#000000] text-[9px] font-mono uppercase tracking-wider text-neutral-400">
                <th className="py-2.5 px-3 font-semibold">Data / Hora</th>
                <th className="py-2.5 px-3 font-semibold">Status</th>
                <th className="py-2.5 px-3 font-semibold">HTTP</th>
                <th className="py-2.5 px-3 font-semibold">Resposta</th>
                <th className="py-2.5 px-3 font-semibold">Resultado</th>
                <th className="py-2.5 px-3 font-semibold">Incidente</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#181818] font-mono text-[11px]">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-neutral-500 font-sans">
                    Nenhum registro de verificação recente para este site.
                  </td>
                </tr>
              ) : (
                history.map((check) => {
                  const isOff = check.status === 'offline';
                  const isCritical = check.status === 'critical';
                  const isWarn = check.status === 'warning';

                  return (
                    <tr 
                      key={check.id}
                      className={isOff || isCritical ? 'bg-rose-950/20' : isWarn ? 'bg-amber-950/15' : 'hover:bg-[#121212]'}
                    >
                      <td className="py-2.5 px-3 text-neutral-300 font-semibold">{check.timestamp}</td>
                      <td className="py-2.5 px-3">
                        {check.status === 'online' && (
                          <span className="text-emerald-400 font-medium flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Online
                          </span>
                        )}
                        {check.status === 'warning' && (
                          <span className="text-amber-400 font-medium flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                            Atenção
                          </span>
                        )}
                        {check.status === 'offline' && (
                          <span className="text-rose-400 font-bold flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                            Offline
                          </span>
                        )}
                        {check.status === 'critical' && (
                          <span className="text-rose-400 font-bold flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                            Falha crítica
                          </span>
                        )}
                        {check.status === 'security_blocked' && (
                          <span className="text-neutral-400 font-bold flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-neutral-500" />
                            Bloqueado por segurança
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-neutral-200 font-bold">{check.httpCode}</td>
                      <td className="py-2.5 px-3 text-neutral-300">
                        {check.responseTime > 0 ? `${check.responseTime.toFixed(2)}s` : check.status === 'security_blocked' ? 'Não aplicável' : check.status === 'offline' || check.status === 'critical' ? 'Indisponível' : 'Falha na verificação'}
                      </td>
                      <td className="py-2.5 px-3 font-sans text-neutral-300">
                        <span className="block">{check.result}</span>
                        {(check.errorType || check.errorMessage) && (
                          <details className="mt-1 text-[9px] text-neutral-500">
                            <summary className="cursor-pointer hover:text-neutral-300">Detalhes técnicos</summary>
                            {check.errorType && <span className="block mt-1">Código: {check.errorType}</span>}
                            {check.errorMessage && <span className="block break-words">Mensagem: {check.errorMessage}</span>}
                          </details>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-neutral-400">
                        {check.incidentId ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-950/30 border border-rose-900/50 text-rose-300">Relacionado</span> : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {hasMoreHistory && (
          <button
            onClick={async () => {
              const page = await getSiteChecksPage(site.id, 50, nextCursor);
              setHistory((current) => [...current, ...page.checks]);
              setNextCursor(page.nextCursor);
              setHasMoreHistory(page.hasMore);
            }}
            className="px-3 py-1.5 rounded bg-[#111] border border-[#252525] text-[10px] font-mono text-neutral-300"
          >
            Carregar mais verificações
          </button>
        )}
      </div>
    </div>
  );
};
