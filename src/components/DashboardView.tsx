import React, { useState, useMemo } from 'react';
import { 
  Plus, 
  Search, 
  AlertOctagon, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  ArrowUpRight, 
  MoreVertical, 
  RefreshCw, 
  Edit3, 
  PauseCircle, 
  PlayCircle, 
  Trash2, 
  ExternalLink,
  ShieldAlert,
  Server,
  Activity,
  Zap,
  Filter,
  Eye,
  Tag
} from 'lucide-react';
import { Site, Incident, SiteStatus } from '../types';
import { getTotalTrackingIssuesCount, getSiteTrackingIssues } from '../utils/trackingAnalyzer';

interface DashboardViewProps {
  sites: Site[];
  incidents: Incident[];
  onAddSite: () => void;
  onSelectSite: (site: Site) => void;
  onEditSite: (site: Site) => void;
  onTogglePause: (siteId: string) => void;
  onDeleteSite: (siteId: string) => void;
  onCheckSiteNow: (siteId: string) => void;
  onSelectIncident: (incident: Incident) => void;
  isCheckingAll?: boolean;
  onCheckAllSites?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  sites,
  incidents,
  onAddSite,
  onSelectSite,
  onEditSite,
  onTogglePause,
  onDeleteSite,
  onCheckSiteNow,
  onSelectIncident,
  isCheckingAll = false,
  onCheckAllSites
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'warning' | 'offline'>('all');
  const [activeActionMenuSiteId, setActiveActionMenuSiteId] = useState<string | null>(null);

  // Metrics computation
  const totalSites = sites.length;
  const onlineSites = sites.filter(s => s.status === 'online').length;
  const warningSites = sites.filter(s => s.status === 'warning').length;
  const offlineSites = sites.filter(s => s.status === 'offline').length;
  const pausedSites = sites.filter(s => s.status === 'paused').length;
  const totalTrackingIssues = getTotalTrackingIssuesCount(sites);

  const avgUptime = (
    sites.reduce((acc, s) => acc + s.uptime30d, 0) / (totalSites || 1)
  ).toFixed(2);

  const activeResponseSites = sites.filter(s => s.status !== 'offline' && s.status !== 'paused');
  const avgResponseTime = (
    activeResponseSites.reduce((acc, s) => acc + s.responseTime, 0) / (activeResponseSites.length || 1)
  ).toFixed(2);

  // Critical offline site detection
  const offlineSite = sites.find(s => s.status === 'offline');
  const activeWarningSites = sites.filter(s => s.status === 'warning');

  // Filter & Prioritize Sorting:
  // 1. Offline -> 2. Warning -> 3. Online -> 4. Paused
  const filteredAndSortedSites = useMemo(() => {
    return sites
      .filter((s) => {
        // Status filter
        if (statusFilter !== 'all' && s.status !== statusFilter) return false;
        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return (
            s.client.toLowerCase().includes(q) ||
            s.domain.toLowerCase().includes(q) ||
            s.siteName.toLowerCase().includes(q) ||
            s.hosting.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        const priorityOrder: Record<SiteStatus, number> = {
          offline: 1,
          warning: 2,
          online: 3,
          paused: 4
        };
        return priorityOrder[a.status] - priorityOrder[b.status];
      });
  }, [sites, statusFilter, searchQuery]);

  const recentIncidents = incidents.slice(0, 4);

  return (
    <div className="space-y-4 sm:space-y-5">
      
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-[#1e1e1e]">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-sans">
            Monitoramento de Sites
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">
            Acompanhe a disponibilidade e a saúde dos sites gerenciados pela Tecnihub.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onCheckAllSites && (
            <button
              onClick={onCheckAllSites}
              disabled={isCheckingAll}
              className="px-3 py-1.5 text-xs font-medium bg-[#111111] hover:bg-[#1a1a1a] text-neutral-300 border border-[#222222] rounded transition-colors flex items-center gap-1.5 disabled:opacity-50"
              title="Executar verificação imediata em todos os sites"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCheckingAll ? 'animate-spin text-white' : 'text-neutral-400'}`} />
              {isCheckingAll ? 'Verificando...' : 'Verificar Todos'}
            </button>
          )}

          <button
            onClick={onAddSite}
            className="px-3 py-1.5 text-xs font-semibold bg-white text-black hover:bg-neutral-200 rounded transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar site
          </button>
        </div>
      </div>

      {/* Resumo Geral (Cards de Métricas) - High Density Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-2.5">
        {/* SITES MONITORADOS */}
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
            Sites Monitorados
          </span>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-bold font-mono text-white">{totalSites}</span>
            <span className="text-[9px] font-mono text-neutral-500">{pausedSites} pausado</span>
          </div>
        </div>

        {/* ONLINE */}
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
              Online
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-bold font-mono text-white">{onlineSites}</span>
            <span className="text-[9px] font-mono text-emerald-400 font-medium">
              {Math.round((onlineSites / (totalSites || 1)) * 100)}%
            </span>
          </div>
        </div>

        {/* ATENÇÃO */}
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
              Atenção
            </span>
            {warningSites > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>}
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className={`text-xl sm:text-2xl font-bold font-mono ${warningSites > 0 ? 'text-amber-400' : 'text-neutral-400'}`}>
              {warningSites}
            </span>
            <span className="text-[9px] font-mono text-neutral-500">Sob alerta</span>
          </div>
        </div>

        {/* FORA DO AR */}
        <div className={`p-3 rounded border flex flex-col justify-between transition-colors ${
          offlineSites > 0 
            ? 'bg-rose-950/20 border-rose-800/60 shadow-[0_0_12px_rgba(239,68,68,0.15)]' 
            : 'bg-[#0a0a0a] border-[#1e1e1e]'
        }`}>
          <div className="flex items-center justify-between">
            <span className={`text-[10px] font-mono uppercase tracking-wider font-semibold ${
              offlineSites > 0 ? 'text-rose-400' : 'text-neutral-400'
            }`}>
              Fora do Ar
            </span>
            {offlineSites > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping"></span>
            )}
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className={`text-xl sm:text-2xl font-bold font-mono ${offlineSites > 0 ? 'text-rose-400 font-black' : 'text-neutral-400'}`}>
              {offlineSites}
            </span>
            <span className={`text-[9px] font-mono font-medium ${offlineSites > 0 ? 'text-rose-400' : 'text-neutral-500'}`}>
              {offlineSites > 0 ? 'Crítico' : 'Zero falhas'}
            </span>
          </div>
        </div>

        {/* UPTIME MÉDIO */}
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
            Uptime Médio
          </span>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-bold font-mono text-white">{avgUptime}%</span>
            <span className="text-[9px] font-mono text-neutral-500">30 dias</span>
          </div>
        </div>

        {/* TEMPO MÉDIO DE RESPOSTA */}
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
            Tempo Resposta
          </span>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-bold font-mono text-white">{avgResponseTime}s</span>
            <span className="text-[9px] font-mono text-neutral-500">Média</span>
          </div>
        </div>
      </div>

      {/* STATUS GERAL - Área Visual Clara com Alto Destaque para Problemas Críticos */}
      <div className="space-y-2.5">
        {/* Offline Critical Alert Box */}
        {offlineSite && (
          <div className="p-3.5 sm:p-4 rounded bg-[#100507] border border-rose-600/50 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded bg-rose-600/20 text-rose-400 border border-rose-500/30 shrink-0 mt-0.5 md:mt-0">
                <AlertOctagon className="w-4 h-4 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-rose-400">
                    Alerta Crítico Operacional
                  </span>
                  <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-rose-500 text-white font-bold">
                    HTTP {offlineSite.httpStatus}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-white mt-0.5">
                  {offlineSite.client} — {offlineSite.domain} está fora do ar
                </h3>
                <p className="text-xs text-neutral-300 mt-0.5 font-mono">
                  O servidor retornou HTTP 503 ({offlineSite.consecutiveFailures} falhas consecutivas). Verificado há 1 minuto.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end md:self-center shrink-0">
              <button
                onClick={() => onCheckSiteNow(offlineSite.id)}
                className="px-2.5 py-1 text-xs font-mono font-medium text-neutral-200 bg-[#141414] hover:bg-[#1e1e1e] border border-[#2a2a2a] rounded transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className="w-3 h-3" />
                Testar Agora
              </button>
              <button
                onClick={() => onSelectSite(offlineSite)}
                className="px-3 py-1 text-xs font-semibold bg-rose-500 hover:bg-rose-600 text-white rounded transition-colors flex items-center gap-1 shadow"
              >
                Ver Detalhes
                <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* Global Summary Bar */}
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center flex-wrap gap-3 font-medium text-[11px]">
            <span className="flex items-center gap-1.5 text-neutral-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <strong className="text-white font-bold">{onlineSites}</strong> sites operando normalmente
            </span>
            <span className="text-neutral-700 hidden sm:inline">•</span>
            <span className="flex items-center gap-1.5 text-neutral-200">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              <strong className="text-white font-bold">{warningSites}</strong> sob alerta
            </span>
            <span className="text-neutral-700 hidden sm:inline">•</span>
            <span className="flex items-center gap-1.5 text-neutral-200">
              <span className={`w-2 h-2 rounded-full ${offlineSites > 0 ? 'bg-rose-500 animate-ping' : 'bg-neutral-600'}`}></span>
              <strong className={`font-bold ${offlineSites > 0 ? 'text-rose-400 font-bold' : 'text-white'}`}>
                {offlineSites}
              </strong> fora do ar
            </span>
            <span className="text-neutral-700 hidden sm:inline">•</span>
            <span className="flex items-center gap-1.5 text-neutral-300 font-mono text-[10px]">
              <Tag className="w-3 h-3 text-neutral-400" />
              <span>Rastreamento: </span>
              {totalTrackingIssues > 0 ? (
                <strong className="text-amber-400 font-semibold">{totalTrackingIssues} divergência{totalTrackingIssues > 1 ? 's' : ''}</strong>
              ) : (
                <strong className="text-emerald-400 font-semibold">100% OK</strong>
              )}
            </span>
          </div>

          <span className="text-[10px] font-mono text-neutral-500">
            Última varredura global: há 42 segundos
          </span>
        </div>
      </div>

      {/* Main Grid: Sites Monitorados Table (Left/Main) + Incidentes Recentes (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        
        {/* Sites Monitorados (Spans 2 columns on xl) */}
        <div className="xl:col-span-2 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight uppercase font-mono">
                Sites monitorados
              </h2>
              <p className="text-[11px] text-neutral-400">
                Lista ordenada por prioridade operacional (problemas no topo)
              </p>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1 p-0.5 rounded bg-[#0a0a0a] border border-[#1e1e1e] text-[11px]">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-0.5 rounded font-medium transition-colors ${
                  statusFilter === 'all'
                    ? 'bg-[#222222] text-white font-semibold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Todos ({totalSites})
              </button>
              <button
                onClick={() => setStatusFilter('online')}
                className={`px-2.5 py-0.5 rounded font-medium transition-colors ${
                  statusFilter === 'online'
                    ? 'bg-[#222222] text-white font-semibold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Online ({onlineSites})
              </button>
              <button
                onClick={() => setStatusFilter('warning')}
                className={`px-2.5 py-0.5 rounded font-medium transition-colors ${
                  statusFilter === 'warning'
                    ? 'bg-[#222222] text-white font-semibold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Atenção ({warningSites})
              </button>
              <button
                onClick={() => setStatusFilter('offline')}
                className={`px-2.5 py-0.5 rounded font-medium transition-colors ${
                  statusFilter === 'offline'
                    ? 'bg-[#222222] text-white font-semibold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Offline ({offlineSites})
              </button>
            </div>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar cliente ou domínio..."
              className="w-full pl-9 pr-3 py-1.5 bg-[#0a0a0a] border border-[#1e1e1e] rounded text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500 transition-colors"
            />
          </div>

          {/* Tabela de Sites - High Density */}
          <div className="rounded border border-[#1e1e1e] bg-[#0a0a0a] overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#1e1e1e] bg-[#000000] text-[9px] font-mono uppercase tracking-wider text-neutral-400">
                    <th className="py-2 px-3 font-semibold">Cliente</th>
                    <th className="py-2 px-3 font-semibold">Site / Domínio</th>
                    <th className="py-2 px-3 font-semibold">Status</th>
                    <th className="py-2 px-3 font-semibold">Uptime</th>
                    <th className="py-2 px-3 font-semibold">Resposta</th>
                    <th className="py-2 px-3 font-semibold">SSL</th>
                    <th className="py-2 px-3 font-semibold">Domínio</th>
                    <th className="py-2 px-3 font-semibold">Última Verificação</th>
                    <th className="py-2 px-2.5 text-right font-semibold">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#181818] font-sans">
                  {filteredAndSortedSites.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-neutral-500 text-xs font-mono">
                        Nenhum site encontrado com os filtros aplicados.
                      </td>
                    </tr>
                  ) : (
                    filteredAndSortedSites.map((site) => {
                      const isOffline = site.status === 'offline';
                      const isWarning = site.status === 'warning';
                      const isPaused = site.status === 'paused';
                      const trackingIssues = getSiteTrackingIssues(site);

                      return (
                        <tr
                          key={site.id}
                          className={`hover:bg-[#121212] transition-colors group cursor-pointer ${
                            isOffline ? 'bg-rose-950/20' : isWarning ? 'bg-amber-950/15' : ''
                          }`}
                          onClick={() => onSelectSite(site)}
                        >
                          {/* Cliente */}
                          <td className="py-2.5 px-3 font-semibold text-white whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span>{site.client}</span>
                              <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#161616] text-neutral-400 border border-[#222222]">
                                {site.hosting}
                              </span>
                              {trackingIssues.length > 0 && (
                                <span
                                  title={`Rastreamento: ${trackingIssues.map(i => `${i.toolName} (${i.statusLabel})`).join(', ')}`}
                                  className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1"
                                >
                                  <Tag className="w-2.5 h-2.5" />
                                  {trackingIssues.length} {trackingIssues.length === 1 ? 'tag' : 'tags'}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Site / Domínio */}
                          <td className="py-2.5 px-3 font-mono text-neutral-300 whitespace-nowrap">
                            <span className="text-[11px] hover:text-white flex items-center gap-1">
                              {site.domain}
                            </span>
                          </td>

                          {/* Status */}
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {site.status === 'online' && (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400 font-mono">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                Online
                              </span>
                            )}
                            {site.status === 'warning' && (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-400 font-mono">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                Atenção
                              </span>
                            )}
                            {site.status === 'offline' && (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-rose-400 font-mono">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                                Offline
                              </span>
                            )}
                            {site.status === 'paused' && (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-neutral-500 font-mono">
                                <span className="w-1.5 h-1.5 rounded-full bg-neutral-600" />
                                Pausado
                              </span>
                            )}
                          </td>

                          {/* Uptime */}
                          <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                            <span className={site.uptime30d < 99.0 ? 'text-amber-400 font-bold' : 'text-neutral-200'}>
                              {site.uptime30d.toFixed(2)}%
                            </span>
                          </td>

                          {/* Resposta */}
                          <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                            {isOffline ? (
                              <span className="text-neutral-500">-</span>
                            ) : (
                              <span className={site.responseTime > 3.0 ? 'text-amber-400 font-bold' : 'text-neutral-200'}>
                                {site.responseTime.toFixed(2)}s
                              </span>
                            )}
                          </td>

                          {/* SSL */}
                          <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                            <span className={site.sslDaysRemaining <= 15 ? 'text-amber-400 font-bold' : 'text-neutral-400'}>
                              {site.sslDaysRemaining}d
                            </span>
                          </td>

                          {/* Domínio */}
                          <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                            <span className={site.domainDaysRemaining <= 15 ? 'text-amber-400 font-bold' : 'text-neutral-400'}>
                              {site.domainDaysRemaining}d
                            </span>
                          </td>

                          {/* Última Verificação */}
                          <td className="py-2.5 px-3 font-mono text-[10px] text-neutral-500 whitespace-nowrap">
                            {site.lastCheck}
                          </td>

                          {/* Ações */}
                          <td 
                            className="py-2.5 px-2.5 text-right whitespace-nowrap relative"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => onCheckSiteNow(site.id)}
                                title="Verificar agora"
                                className="p-1 text-neutral-400 hover:text-white rounded hover:bg-[#181818] transition-colors"
                              >
                                <RefreshCw className="w-3 h-3" />
                              </button>

                              <button
                                onClick={() => onSelectSite(site)}
                                title="Ver detalhes"
                                className="p-1 text-neutral-400 hover:text-white rounded hover:bg-[#181818] transition-colors"
                              >
                                <Eye className="w-3 h-3" />
                              </button>

                              <div className="relative">
                                <button
                                  onClick={() => setActiveActionMenuSiteId(activeActionMenuSiteId === site.id ? null : site.id)}
                                  className="p-1 text-neutral-400 hover:text-white rounded hover:bg-[#181818] transition-colors"
                                >
                                  <MoreVertical className="w-3 h-3" />
                                </button>

                                {activeActionMenuSiteId === site.id && (
                                  <div className="absolute right-0 mt-1 w-44 bg-[#0d0d0d] border border-[#282828] rounded shadow-xl py-1 z-30 text-xs">
                                    <button
                                      onClick={() => {
                                        onSelectSite(site);
                                        setActiveActionMenuSiteId(null);
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-neutral-200 hover:bg-[#1a1a1a] flex items-center gap-2"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                      Ver detalhes
                                    </button>
                                    <button
                                      onClick={() => {
                                        onCheckSiteNow(site.id);
                                        setActiveActionMenuSiteId(null);
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-neutral-200 hover:bg-[#1a1a1a] flex items-center gap-2"
                                    >
                                      <RefreshCw className="w-3.5 h-3.5" />
                                      Verificar agora
                                    </button>
                                    <button
                                      onClick={() => {
                                        onEditSite(site);
                                        setActiveActionMenuSiteId(null);
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-neutral-200 hover:bg-[#1a1a1a] flex items-center gap-2"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                      Editar
                                    </button>
                                    <button
                                      onClick={() => {
                                        onTogglePause(site.id);
                                        setActiveActionMenuSiteId(null);
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-neutral-200 hover:bg-[#1a1a1a] flex items-center gap-2"
                                    >
                                      {isPaused ? (
                                        <>
                                          <PlayCircle className="w-3.5 h-3.5 text-emerald-400" />
                                          Retomar monitoramento
                                        </>
                                      ) : (
                                        <>
                                          <PauseCircle className="w-3.5 h-3.5 text-amber-400" />
                                          Pausar monitoramento
                                        </>
                                      )}
                                    </button>
                                    <div className="border-t border-[#1e1e1e] my-1"></div>
                                    <button
                                      onClick={() => {
                                        onDeleteSite(site.id);
                                        setActiveActionMenuSiteId(null);
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-rose-400 hover:bg-rose-950/30 flex items-center gap-2"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      Excluir
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
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

        {/* Incidentes Recentes (Right Column on xl) - High Density Cards */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight uppercase font-mono">
                Incidentes recentes
              </h2>
              <p className="text-[11px] text-neutral-400">
                Eventos e anomalias registradas
              </p>
            </div>
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#161616] text-neutral-400 font-semibold border border-[#222222]">
              Tempo Real
            </span>
          </div>

          <div className="space-y-2">
            {recentIncidents.map((incident) => {
              const isCrit = incident.severity === 'critical';
              const isResolved = incident.status === 'resolved';

              return (
                <div
                  key={incident.id}
                  onClick={() => onSelectIncident(incident)}
                  className={`p-3 rounded border transition-all cursor-pointer group ${
                    isCrit && !isResolved
                      ? 'bg-rose-950/20 border-rose-900/50 hover:border-rose-700/60'
                      : isResolved
                      ? 'bg-[#0a0a0a] border-[#1e1e1e] hover:border-neutral-700'
                      : 'bg-amber-950/15 border-amber-900/50 hover:border-amber-700/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[9px] font-mono uppercase font-bold text-neutral-400">
                        {incident.client}
                      </span>
                      <h4 className="text-xs font-semibold text-white group-hover:text-white transition-colors mt-0.5">
                        {incident.type}
                      </h4>
                    </div>

                    <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold uppercase shrink-0 ${
                      isCrit && !isResolved
                        ? 'bg-rose-500 text-white'
                        : isResolved
                        ? 'bg-[#161616] text-neutral-400 border border-[#222222]'
                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    }`}>
                      {isResolved ? 'Resolvido' : isCrit ? 'Crítico' : 'Atenção'}
                    </span>
                  </div>

                  <p className="text-[11px] text-neutral-300 mt-1.5 font-mono line-clamp-2">
                    {incident.currentStatus}
                  </p>

                  <div className="mt-2 pt-1.5 border-t border-[#181818] flex items-center justify-between text-[9px] font-mono text-neutral-500">
                    <span className="flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {incident.createdAt}
                    </span>
                    <span className="text-neutral-400 group-hover:text-white transition-colors flex items-center gap-1">
                      Ver detalhes
                      <ArrowUpRight className="w-2.5 h-2.5" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
