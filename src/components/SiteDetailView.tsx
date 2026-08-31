import React, { useState } from 'react';
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
import { Site, CheckRecord, TrackingStatusColor } from '../types';
import { TRACKING_TOOLS, analyzeSiteTracking } from '../utils/trackingAnalyzer';

interface SiteDetailViewProps {
  site: Site;
  onBack: () => void;
  onCheckNow: (siteId: string) => void;
  onEdit: (site: Site) => void;
  onTogglePause: (siteId: string) => void;
  onVerifyTracking?: (siteId: string) => void;
  isChecking?: boolean;
}

export const SiteDetailView: React.FC<SiteDetailViewProps> = ({
  site,
  onBack,
  onCheckNow,
  onEdit,
  onTogglePause,
  onVerifyTracking,
  isChecking = false
}) => {
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d' | '90d'>('24h');
  const [isVerifyingTracking, setIsVerifyingTracking] = useState(false);

  const handleVerifyTrackingClick = () => {
    setIsVerifyingTracking(true);
    if (onVerifyTracking) {
      onVerifyTracking(site.id);
    }
    setTimeout(() => {
      setIsVerifyingTracking(false);
    }, 800);
  };

  // Simulated latency chart data based on time range
  const latencyData = React.useMemo(() => {
    if (timeRange === '24h') {
      return [
        { time: '00:00', responseTime: 0.82, uptime: 100 },
        { time: '03:00', responseTime: 0.78, uptime: 100 },
        { time: '06:00', responseTime: 0.81, uptime: 100 },
        { time: '09:00', responseTime: 0.95, uptime: 100 },
        { time: '11:00', responseTime: 0.89, uptime: 100 },
        { time: '12:00', responseTime: 1.05, uptime: 100 },
        { time: '12:30', responseTime: site.status === 'warning' ? 5.2 : 0.85, uptime: site.status === 'offline' ? 0 : 100 },
        { time: '13:00', responseTime: site.status === 'warning' ? 4.9 : 0.82, uptime: site.status === 'offline' ? 0 : 100 },
        { time: '13:30', responseTime: site.responseTime || 0.84, uptime: site.status === 'offline' ? 0 : 100 },
      ];
    } else if (timeRange === '7d') {
      return [
        { time: 'Seg', responseTime: 0.85, uptime: 100 },
        { time: 'Ter', responseTime: 0.88, uptime: 100 },
        { time: 'Qua', responseTime: 0.82, uptime: 100 },
        { time: 'Qui', responseTime: 0.94, uptime: 99.8 },
        { time: 'Sex', responseTime: 0.91, uptime: 100 },
        { time: 'Sáb', responseTime: 0.78, uptime: 100 },
        { time: 'Dom', responseTime: site.responseTime || 0.84, uptime: site.status === 'offline' ? 85 : 100 },
      ];
    } else if (timeRange === '30d') {
      return Array.from({ length: 15 }, (_, i) => ({
        time: `Dia ${i * 2 + 1}`,
        responseTime: +(0.7 + Math.random() * 0.35 + (site.status === 'warning' && i > 12 ? 3.5 : 0)).toFixed(2),
        uptime: site.status === 'offline' && i === 14 ? 80 : 100
      }));
    } else {
      return [
        { time: 'Jun', responseTime: 0.82, uptime: 100 },
        { time: 'Jul', responseTime: 0.85, uptime: 99.9 },
        { time: 'Ago', responseTime: site.responseTime || 0.9, uptime: site.uptime30d }
      ];
    }
  }, [timeRange, site]);

  // Availability heat bars for 90 days representation
  const uptimeBlocks = React.useMemo(() => {
    return Array.from({ length: 45 }, (_, i) => {
      const isLast = i === 44;
      if (isLast && site.status === 'offline') return 'offline';
      if (isLast && site.status === 'warning') return 'warning';
      if (i === 12 && site.uptime30d < 99.5) return 'incident';
      return 'online';
    });
  }, [site]);

  const isPaused = site.status === 'paused';

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
                Retomar
              </>
            ) : (
              <>
                <PauseCircle className="w-3.5 h-3.5 text-amber-400" />
                Pausar
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
              : site.status === 'warning'
              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              : site.status === 'offline'
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
                  : site.status === 'warning'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : site.status === 'offline'
                  ? 'bg-rose-500 text-white font-bold'
                  : 'bg-[#161616] text-neutral-400 border border-[#222222]'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  site.status === 'online' ? 'bg-emerald-400' :
                  site.status === 'warning' ? 'bg-amber-400' :
                  site.status === 'offline' ? 'bg-white animate-pulse' : 'bg-neutral-500'
                }`} />
                {site.status === 'online' ? 'ONLINE' : site.status === 'warning' ? 'ATENÇÃO' : site.status === 'offline' ? 'OFFLINE' : 'PAUSADO'}
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 mt-0.5 font-mono">
              Última verificação: <strong className="text-neutral-200">{site.lastCheck}</strong> • Frequência: <strong className="text-neutral-200">{site.frequency}</strong>
            </p>
          </div>
        </div>

        {site.status === 'offline' && (
          <div className="px-2.5 py-1 rounded bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-mono">
            Falha detectada: Servidor retornou HTTP 503
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
              site.status === 'warning' ? 'text-amber-400' :
              site.status === 'offline' ? 'text-rose-400' : 'text-neutral-400'
            }`}>
              {site.status}
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
              {site.uptime30d.toFixed(2)}%
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
              {site.status === 'offline' ? '-' : `${site.responseTime.toFixed(2)}s`}
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
              site.sslDaysRemaining <= 15 ? 'text-amber-400' : 'text-emerald-400'
            }`}>
              {site.sslValid ? 'Válido' : 'Inválido'}
            </span>
            <span className="text-[10px] font-mono text-neutral-400">
              {site.sslDaysRemaining}d restantes
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
              {site.domainDaysRemaining}d
            </span>
            <span className="text-[10px] font-mono text-neutral-400">
              restantes
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
              {site.httpStatus === 200 ? '200 OK' : site.httpStatus}
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
              Cada bloco representa a saúde em intervalos sucessivos
            </p>
          </div>
          <span className="text-xs font-mono font-bold text-emerald-400">
            {site.uptime30d.toFixed(2)}% de disponibilidade
          </span>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto py-1">
          {uptimeBlocks.map((status, idx) => {
            const bg = {
              online: 'bg-emerald-500/80 hover:bg-emerald-400',
              warning: 'bg-amber-500/90 hover:bg-amber-400',
              offline: 'bg-rose-500 hover:bg-rose-400',
              incident: 'bg-amber-500/70 hover:bg-amber-400'
            }[status];

            return (
              <div
                key={idx}
                title={`Ponto de verificação ${idx + 1}: ${status}`}
                className={`h-6 flex-1 min-w-[5px] rounded-xs transition-colors cursor-pointer ${bg}`}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[9px] font-mono text-neutral-500 pt-0.5">
          <span>90 dias atrás</span>
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
        </div>
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
              Última verificação de rastreamento: <strong className="text-neutral-200">{site.tracking?.lastCheckedAt || site.lastCheck || 'Hoje às 11:20'}</strong>
            </p>
          </div>

          <button
            onClick={handleVerifyTrackingClick}
            disabled={isVerifyingTracking}
            className="px-3 py-1.5 text-xs font-medium text-neutral-200 bg-[#111111] hover:bg-[#1a1a1a] hover:text-white border border-[#222222] rounded transition-colors flex items-center gap-1.5 disabled:opacity-50 self-start sm:self-auto"
            title="Realizar novamente a análise de tags e integrações"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isVerifyingTracking ? 'animate-spin text-white' : 'text-neutral-400'}`} />
            {isVerifyingTracking ? 'Analisando tags...' : 'Verificar rastreamento'}
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
            const status: TrackingStatusColor = toolRes?.status || 'gray';
            const statusLabel = toolRes?.statusLabel || 'Não utilizado';
            const displayId = toolRes?.foundId || toolRes?.expectedId;

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
                      {status === 'green' ? 'Configurado' : status === 'yellow' ? 'Pendente' : 'Não utilizado'}
                    </span>
                  ) : status === 'gray' ? (
                    <span className="text-[10px] font-mono text-neutral-600 block">
                      Não configurado
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
              <span className="text-emerald-400 font-mono font-medium">Ativo</span>
            </div>
            <div className="p-2 rounded bg-[#000000] border border-[#1e1e1e] flex items-center justify-between">
              <span className="text-neutral-400">Tempo de resposta:</span>
              <span className="text-emerald-400 font-mono font-medium">Ativo (&lt;3s)</span>
            </div>
            <div className="p-2 rounded bg-[#000000] border border-[#1e1e1e] flex items-center justify-between">
              <span className="text-neutral-400">Certificado SSL:</span>
              <span className="text-emerald-400 font-mono font-medium">Ativo</span>
            </div>
            <div className="p-2 rounded bg-[#000000] border border-[#1e1e1e] flex items-center justify-between">
              <span className="text-neutral-400">Domínio WHOIS:</span>
              <span className="text-emerald-400 font-mono font-medium">Ativo</span>
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
                O monitor verifica se o HTML retornado contém a expressão:
              </p>
              <div className="p-2 rounded bg-[#000000] border border-[#1e1e1e] font-mono text-xs text-emerald-300 flex items-center justify-between">
                <span>"{site.expectedContentText}"</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400">
                  Encontrado
                </span>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-neutral-500 py-1 font-mono">
              Verificação de conteúdo desativada para este site.
            </p>
          )}
        </div>
      </div>

      {/* Tabela: Últimas Verificações - High Density */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-white tracking-tight uppercase font-mono">
            Últimas verificações
          </h3>
          <span className="text-[10px] font-mono text-neutral-500">
            Pings automáticos registrados
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
              </tr>
            </thead>
            <tbody className="divide-y divide-[#181818] font-mono text-[11px]">
              {site.checksHistory.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-neutral-500 font-sans">
                    Nenhum registro de verificação recente para este site.
                  </td>
                </tr>
              ) : (
                site.checksHistory.map((check) => {
                  const isOff = check.status === 'offline';
                  const isWarn = check.status === 'warning';

                  return (
                    <tr 
                      key={check.id}
                      className={isOff ? 'bg-rose-950/20' : isWarn ? 'bg-amber-950/15' : 'hover:bg-[#121212]'}
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
                      </td>
                      <td className="py-2.5 px-3 text-neutral-200 font-bold">{check.httpCode}</td>
                      <td className="py-2.5 px-3 text-neutral-300">
                        {check.responseTime > 0 ? `${check.responseTime.toFixed(2)}s` : '-'}
                      </td>
                      <td className="py-2.5 px-3 font-sans text-neutral-300">
                        {check.result}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
