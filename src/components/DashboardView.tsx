import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  Globe,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react';
import { Site, Incident, SiteStatus } from '../types';
import { domainUnavailableLabel, responseTimeUnavailableLabel, sslUnavailableLabel } from '../utils/diagnosticLabels';

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
  checkingSiteId?: string | null;
}

interface SiteActionsMenuProps {
  anchor: HTMLButtonElement;
  site: Site;
  checkingSiteId: string | null;
  onClose: () => void;
  onSelectSite: (site: Site) => void;
  onEditSite: (site: Site) => void;
  onTogglePause: (siteId: string) => void;
  onDeleteSite: (siteId: string) => void;
  onCheckSiteNow: (siteId: string) => void;
}

const ACTION_MENU_WIDTH = 176;
const VIEWPORT_MARGIN = 8;
const ACTION_MENU_GAP = 4;

const SiteActionsMenu: React.FC<SiteActionsMenuProps> = ({
  anchor,
  site,
  checkingSiteId,
  onClose,
  onSelectSite,
  onEditSite,
  onTogglePause,
  onDeleteSite,
  onCheckSiteNow
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, ready: false });
  const isPaused = site.status === 'paused';

  const updatePosition = useCallback(() => {
    const anchorRect = anchor.getBoundingClientRect();
    const anchorIsOutsideViewport = anchorRect.bottom < 0
      || anchorRect.top > window.innerHeight
      || anchorRect.right < 0
      || anchorRect.left > window.innerWidth;
    if (anchorIsOutsideViewport) {
      setPosition((current) => ({ ...current, ready: false }));
      return;
    }

    const menuHeight = menuRef.current?.offsetHeight ?? 208;
    const availableBelow = window.innerHeight - anchorRect.bottom - ACTION_MENU_GAP - VIEWPORT_MARGIN;
    const canOpenAbove = anchorRect.top - ACTION_MENU_GAP - VIEWPORT_MARGIN >= menuHeight;
    const desiredTop = availableBelow < menuHeight && canOpenAbove
      ? anchorRect.top - menuHeight - ACTION_MENU_GAP
      : anchorRect.bottom + ACTION_MENU_GAP;

    setPosition({
      top: Math.min(
        Math.max(VIEWPORT_MARGIN, desiredTop),
        Math.max(VIEWPORT_MARGIN, window.innerHeight - menuHeight - VIEWPORT_MARGIN)
      ),
      left: Math.min(
        Math.max(VIEWPORT_MARGIN, anchorRect.right - ACTION_MENU_WIDTH),
        Math.max(VIEWPORT_MARGIN, window.innerWidth - ACTION_MENU_WIDTH - VIEWPORT_MARGIN)
      ),
      ready: true
    });
  }, [anchor]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        anchor.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchor, onClose, updatePosition]);

  const runAction = (action: () => void) => {
    action();
    onClose();
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Ações de ${site.siteName}`}
      className="fixed z-[100] w-44 rounded border border-[#282828] bg-[#0d0d0d] py-1 text-left text-xs shadow-2xl"
      style={{
        top: position.top,
        left: position.left,
        visibility: position.ready ? 'visible' : 'hidden'
      }}
    >
      <button type="button" role="menuitem" onClick={() => runAction(() => onSelectSite(site))} className="flex w-full items-center gap-2 px-3 py-1.5 text-neutral-200 hover:bg-[#1a1a1a]">
        <Eye className="h-3.5 w-3.5" /> Ver detalhes
      </button>
      <button type="button" role="menuitem" onClick={() => runAction(() => onCheckSiteNow(site.id))} disabled={checkingSiteId === site.id} className="flex w-full items-center gap-2 px-3 py-1.5 text-neutral-200 hover:bg-[#1a1a1a] disabled:opacity-50">
        <RefreshCw className={`h-3.5 w-3.5 ${checkingSiteId === site.id ? 'animate-spin text-emerald-400' : ''}`} />
        {checkingSiteId === site.id ? 'Verificando...' : 'Verificar agora'}
      </button>
      <button type="button" role="menuitem" onClick={() => runAction(() => onEditSite(site))} className="flex w-full items-center gap-2 px-3 py-1.5 text-neutral-200 hover:bg-[#1a1a1a]">
        <Edit3 className="h-3.5 w-3.5" /> Editar
      </button>
      <button type="button" role="menuitem" onClick={() => runAction(() => onTogglePause(site.id))} className="flex w-full items-center gap-2 px-3 py-1.5 text-neutral-200 hover:bg-[#1a1a1a]">
        {isPaused ? <PlayCircle className="h-3.5 w-3.5 text-emerald-400" /> : <PauseCircle className="h-3.5 w-3.5 text-amber-400" />}
        {isPaused ? 'Reativar monitoramento' : 'Desativar monitoramento'}
      </button>
      <div className="my-1 border-t border-[#1e1e1e]" />
      <button type="button" role="menuitem" onClick={() => runAction(() => onDeleteSite(site.id))} className="flex w-full items-center gap-2 px-3 py-1.5 text-rose-400 hover:bg-rose-950/30">
        <Trash2 className="h-3.5 w-3.5" /> Excluir
      </button>
    </div>,
    document.body
  );
};

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
  onCheckAllSites,
  checkingSiteId = null
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'warning' | 'offline'>('all');
  const [activeActionMenuSiteId, setActiveActionMenuSiteId] = useState<string | null>(null);
  const [activeActionMenuAnchor, setActiveActionMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const [isIncidentsCollapsed, setIsIncidentsCollapsed] = useState(false);

  // Metrics computation
  const totalSites = sites.length;
  const onlineSites = sites.filter(s => s.status === 'online').length;
  const warningSites = sites.filter(s => s.status === 'warning' || s.status === 'security_blocked').length;
  const offlineSites = sites.filter(s => s.status === 'offline' || s.status === 'critical').length;
  const pausedSites = sites.filter(s => s.status === 'paused').length;
  const uptimeValues = sites.filter((site) => site.uptime30dReliable).map((site) => site.uptime30d).filter((value): value is number => value !== null);
  const avgUptime = uptimeValues.length
    ? (uptimeValues.reduce((sum, value) => sum + value, 0) / uptimeValues.length).toFixed(2)
    : null;

  const responseValues = sites.map((site) => site.responseTime).filter((value): value is number => value !== null);
  const avgResponseTime = responseValues.length
    ? (responseValues.reduce((sum, value) => sum + value, 0) / responseValues.length).toFixed(2)
    : null;

  // Critical offline site detection
  const offlineSite = sites.find(s => s.status === 'offline' || s.status === 'critical');
  const activeWarningSites = sites.filter(s => s.status === 'warning' || s.status === 'security_blocked');
  const latestGlobalCheck = sites
    .flatMap((site) => site.checksHistory)
    .sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime())[0];

  // Filter & Prioritize Sorting:
  // 1. Offline -> 2. Warning -> 3. Online -> 4. Paused
  const filteredAndSortedSites = useMemo(() => {
    return sites
      .filter((s) => {
        // Status filter
        if (
          statusFilter !== 'all' &&
          !(statusFilter === 'offline' && (s.status === 'offline' || s.status === 'critical')) &&
          !(statusFilter === 'warning' && s.status === 'security_blocked') &&
          s.status !== statusFilter
        ) return false;
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
          critical: 1,
          offline: 2,
          warning: 3,
          online: 4,
          security_blocked: 4,
          unknown: 5,
          paused: 6
        };
        return priorityOrder[a.status] - priorityOrder[b.status];
      });
  }, [sites, statusFilter, searchQuery]);

  const recentIncidents = incidents.slice(0, 4);
  const activeActionMenuSite = activeActionMenuSiteId
    ? filteredAndSortedSites.find((site) => site.id === activeActionMenuSiteId) ?? null
    : null;
  const closeActionMenu = useCallback(() => {
    setActiveActionMenuSiteId(null);
    setActiveActionMenuAnchor(null);
  }, []);

  return (
    <div className="min-w-0 max-w-full space-y-4 sm:space-y-5">
      
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-[#1e1e1e]">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-sans">
            Monitoramento de Sites
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">
            Acompanhe a disponibilidade e a saúde dos sites gerenciados pela <span className="font-brand">Tecnihub</span>.
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
            Sites Cadastrados
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
              Crítico / Offline
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
            <span className="text-xl sm:text-2xl font-bold font-mono text-white">{avgUptime === null ? 'Sem dados suficientes' : `${avgUptime}%`}</span>
            <span className="text-[9px] font-mono text-neutral-500">30 dias</span>
          </div>
        </div>

        {/* TEMPO MÉDIO DE RESPOSTA */}
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
            Tempo Resposta
          </span>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-bold font-mono text-white">{avgResponseTime === null ? 'Sem dados suficientes' : `${avgResponseTime}s`}</span>
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
                    Falha confirmada
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-white mt-0.5">
                  {offlineSite.client} — {offlineSite.domain} requer atenção imediata
                </h3>
                <p className="text-xs text-neutral-300 mt-0.5 font-mono">
                  {offlineSite.checksHistory[0]?.result || 'Não foi possível obter o resultado do check'} ({offlineSite.consecutiveFailures} falha(s) consecutiva(s) nos checks carregados).
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
            <span className="text-neutral-500 font-mono text-[10px]">Tracking: indisponível</span>
          </div>

          <span className="text-[10px] font-mono text-neutral-500">
            Último check: {latestGlobalCheck?.timestamp || 'Ainda não verificado'}
          </span>
        </div>
      </div>

      {/* Main Grid: Sites Monitorados Table (Left/Main) + Incidentes Recentes (Right) */}
      <div className={`grid min-w-0 grid-cols-1 gap-4 ${
        isIncidentsCollapsed
          ? '2xl:grid-cols-[minmax(0,1fr)_2.75rem]'
          : '2xl:grid-cols-[minmax(0,1fr)_17rem]'
      }`}>
        
        {/* Sites Monitorados: coluna principal flexível */}
        <div className="min-w-0 space-y-3">
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
            <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded border border-[#1e1e1e] bg-[#0a0a0a] p-0.5 text-[11px] sm:w-auto">
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

          {/* Tabela de Sites ou Estado Vazio */}
          {sites.length === 0 ? (
            <div className="p-8 text-center bg-[#0a0a0a] border border-[#1e1e1e] rounded shadow-xs">
              <div className="w-10 h-10 rounded-full bg-[#141414] border border-[#222222] flex items-center justify-center mx-auto mb-3 text-neutral-400">
                <Globe className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white font-sans mb-1">
                Nenhum site sendo monitorado.
              </h3>
              <p className="text-xs text-neutral-400 font-mono max-w-md mx-auto mb-4">
                Cadastre o primeiro site para iniciar o monitoramento HTTP contínuo dos serviços <span className="font-brand">TECNIHUB</span>.
              </p>
              <button
                onClick={onAddSite}
                className="px-3.5 py-1.5 text-xs font-semibold bg-white text-black hover:bg-neutral-200 rounded transition-colors shadow-xs inline-flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Adicionar primeiro site
              </button>
            </div>
          ) : (
            <div className="min-w-0 max-w-full overflow-hidden rounded border border-[#1e1e1e] bg-[#0a0a0a] shadow-xs">
              <div className="max-w-full overflow-x-auto overscroll-x-contain">
                <table className="w-full min-w-max border-collapse text-left text-xs">
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
                      const isCritical = site.status === 'critical';
                      const isWarning = site.status === 'warning' || site.status === 'security_blocked';
                      return (
                        <tr
                          key={site.id}
                          className={`hover:bg-[#121212] transition-colors group cursor-pointer ${
                            isOffline || isCritical ? 'bg-rose-950/20' : isWarning ? 'bg-amber-950/15' : ''
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
                            {site.status === 'security_blocked' && (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-neutral-400 font-mono">
                                <span className="w-1.5 h-1.5 rounded-full bg-neutral-500" /> Verificação bloqueada
                              </span>
                            )}
                            {site.status === 'critical' && (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-rose-400 font-mono">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                Falha crítica
                              </span>
                            )}
                            {site.status === 'paused' && (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-neutral-500 font-mono">
                                <span className="w-1.5 h-1.5 rounded-full bg-neutral-600" />
                                Pausado
                              </span>
                            )}
                            {site.status === 'unknown' && (
                              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-neutral-500 font-mono">
                                <span className="w-1.5 h-1.5 rounded-full bg-neutral-600" />
                                Status ainda não confirmado
                              </span>
                            )}
                          </td>

                          {/* Uptime */}
                          <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                            <span className={site.uptime30d !== null && site.uptime30d < 99.0 ? 'text-amber-400 font-bold' : 'text-neutral-200'}>
                              {site.uptime30d === null ? 'Sem dados suficientes' : site.uptime30dReliable ? `${site.uptime30d.toFixed(2)}%` : `Parcial (${site.uptime30d.toFixed(2)}%)`}
                            </span>
                          </td>

                          {/* Resposta */}
                          <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                            {isOffline || site.responseTime === null ? (
                              <span className="text-neutral-500">{responseTimeUnavailableLabel(site)}</span>
                            ) : (
                              <span className={site.responseTime > 3.0 ? 'text-amber-400 font-bold' : 'text-neutral-200'}>
                                {site.responseTime.toFixed(2)}s
                              </span>
                            )}
                          </td>

                          {/* SSL */}
                          <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                            <span className={site.sslDaysRemaining !== null && site.sslDaysRemaining <= 15 ? 'text-amber-400 font-bold' : 'text-neutral-400'}>
                              {site.sslDaysRemaining === null ? sslUnavailableLabel(site) : `${site.sslDaysRemaining}d`}
                            </span>
                          </td>

                          {/* Domínio */}
                          <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap">
                            <span className={site.domainDaysRemaining !== null && site.domainDaysRemaining <= 15 ? 'text-amber-400 font-bold' : 'text-neutral-400'}>
                              {site.domainDaysRemaining === null ? domainUnavailableLabel(site) : `${site.domainDaysRemaining}d`}
                            </span>
                          </td>

                          {/* Última Verificação */}
                          <td className="py-2.5 px-3 font-mono text-[10px] text-neutral-500 whitespace-nowrap">
                            {site.lastCheck}
                          </td>

                          {/* Ações */}
                          <td 
                            className="whitespace-nowrap px-2.5 py-2.5 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => onCheckSiteNow(site.id)}
                                disabled={checkingSiteId === site.id}
                                title={checkingSiteId === site.id ? 'Verificando...' : 'Verificar agora'}
                                className="p-1 text-neutral-400 hover:text-white rounded hover:bg-[#181818] transition-colors disabled:opacity-50"
                              >
                                <RefreshCw className={`w-3 h-3 ${checkingSiteId === site.id ? 'animate-spin text-emerald-400' : ''}`} />
                              </button>

                              <button
                                onClick={() => onSelectSite(site)}
                                title="Ver detalhes"
                                className="p-1 text-neutral-400 hover:text-white rounded hover:bg-[#181818] transition-colors"
                              >
                                <Eye className="w-3 h-3" />
                              </button>

                              <button
                                type="button"
                                aria-haspopup="menu"
                                aria-expanded={activeActionMenuSiteId === site.id}
                                aria-label={`Abrir ações de ${site.siteName}`}
                                onClick={(event) => {
                                  if (activeActionMenuSiteId === site.id) {
                                    closeActionMenu();
                                    return;
                                  }
                                  setActiveActionMenuSiteId(site.id);
                                  setActiveActionMenuAnchor(event.currentTarget);
                                }}
                                className="rounded p-1 text-neutral-400 transition-colors hover:bg-[#181818] hover:text-white"
                              >
                                <MoreVertical className="h-3 w-3" />
                              </button>
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
        )}
      </div>

        {/* Incidentes Recentes: faixa compacta no desktop e seção abaixo da tabela em telas menores */}
        <aside className={`min-w-0 ${isIncidentsCollapsed ? '' : 'space-y-3'}`}>
          <div className={`flex min-w-0 items-start justify-between gap-2 ${isIncidentsCollapsed ? '2xl:justify-center' : ''}`}>
            <div className={`min-w-0 ${isIncidentsCollapsed ? '2xl:hidden' : ''}`}>
              <h2 className="text-sm font-bold text-white tracking-tight uppercase font-mono">
                Incidentes recentes
              </h2>
              <p className="text-[11px] text-neutral-400">
                Eventos e anomalias registradas
              </p>
              {!isIncidentsCollapsed && (
                <span className="mt-1.5 inline-flex rounded border border-[#222222] bg-[#161616] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-neutral-400">
                  Dados persistidos
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsIncidentsCollapsed((current) => !current)}
              aria-expanded={!isIncidentsCollapsed}
              aria-label={isIncidentsCollapsed ? 'Expandir incidentes recentes' : 'Recolher incidentes recentes'}
              title={isIncidentsCollapsed ? 'Expandir incidentes recentes' : 'Recolher incidentes recentes'}
              className="shrink-0 rounded border border-[#222222] bg-[#0a0a0a] p-1.5 text-neutral-400 transition-colors hover:border-neutral-600 hover:text-white"
            >
              {isIncidentsCollapsed ? <PanelRightOpen className="h-3.5 w-3.5" /> : <PanelRightClose className="h-3.5 w-3.5" />}
            </button>
          </div>

          {!isIncidentsCollapsed && <div className="space-y-2">
            {recentIncidents.length === 0 && (
              <div className="rounded border border-[#1e1e1e] bg-[#0a0a0a] p-4 text-center font-mono text-[11px] text-neutral-500">
                Sem incidentes registrados.
              </div>
            )}
            {recentIncidents.map((incident) => {
              const isCrit = incident.severity === 'critical';
              const isResolved = incident.status === 'resolved';

              return (
                <div
                  key={incident.id}
                  onClick={() => onSelectIncident(incident)}
                  className={`group cursor-pointer rounded border p-2.5 transition-all ${
                    isCrit && !isResolved
                      ? 'bg-rose-950/20 border-rose-900/50 hover:border-rose-700/60'
                      : isResolved
                      ? 'bg-[#0a0a0a] border-[#1e1e1e] hover:border-neutral-700'
                      : 'bg-amber-950/15 border-amber-900/50 hover:border-amber-700/60'
                  }`}
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[9px] font-mono uppercase font-bold text-neutral-400">
                        {incident.client}
                      </span>
                      <h4 className="mt-0.5 line-clamp-2 text-xs font-semibold leading-4 text-white transition-colors group-hover:text-white">
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

                  <p className="mt-1 line-clamp-2 font-mono text-[11px] leading-4 text-neutral-300">
                    {incident.currentStatus}
                  </p>

                  <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-[#181818] pt-1.5 font-mono text-[9px] text-neutral-500">
                    <span className="flex min-w-0 items-center gap-1">
                      <Clock className="h-2.5 w-2.5 shrink-0" />
                      {incident.createdAt}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-neutral-400 transition-colors group-hover:text-white">
                      Ver detalhes
                      <ArrowUpRight className="h-2.5 w-2.5" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>}
        </aside>
      </div>

      {activeActionMenuSite && activeActionMenuAnchor && (
        <SiteActionsMenu
          anchor={activeActionMenuAnchor}
          site={activeActionMenuSite}
          checkingSiteId={checkingSiteId}
          onClose={closeActionMenu}
          onSelectSite={onSelectSite}
          onEditSite={onEditSite}
          onTogglePause={onTogglePause}
          onDeleteSite={onDeleteSite}
          onCheckSiteNow={onCheckSiteNow}
        />
      )}
    </div>
  );
};
