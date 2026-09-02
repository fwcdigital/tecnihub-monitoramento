import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { 
  Search, 
  Plus, 
  RefreshCw, 
  MoreVertical, 
  Eye, 
  Edit3, 
  PauseCircle, 
  PlayCircle, 
  Trash2,
  Globe,
  Download
} from 'lucide-react';
import { Site, SiteStatus } from '../types';
import { domainUnavailableLabel, responseTimeUnavailableLabel, siteStatusLabel, sslUnavailableLabel } from '../utils/diagnosticLabels';

interface SitesViewProps {
  sites: Site[];
  onAddSite: () => void;
  onSelectSite: (site: Site) => void;
  onEditSite: (site: Site) => void;
  onTogglePause: (siteId: string) => void;
  onDeleteSite: (siteId: string) => void;
  onCheckSiteNow: (siteId: string) => void;
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

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const ACTION_MENU_WIDTH = 176;
const VIEWPORT_MARGIN = 8;
const ACTION_MENU_GAP = 4;

function getVisiblePages(currentPage: number, totalPages: number): Array<number | string> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages: Array<number | string> = [1];
  const rangeStart = Math.max(2, currentPage - 1);
  const rangeEnd = Math.min(totalPages - 1, currentPage + 1);

  if (rangeStart > 2) pages.push('ellipsis-start');
  for (let page = rangeStart; page <= rangeEnd; page++) pages.push(page);
  if (rangeEnd < totalPages - 1) pages.push('ellipsis-end');
  pages.push(totalPages);

  return pages;
}

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
    const shouldOpenAbove = availableBelow < menuHeight && canOpenAbove;
    const desiredTop = shouldOpenAbove
      ? anchorRect.top - menuHeight - ACTION_MENU_GAP
      : anchorRect.bottom + ACTION_MENU_GAP;
    const top = Math.min(
      Math.max(VIEWPORT_MARGIN, desiredTop),
      Math.max(VIEWPORT_MARGIN, window.innerHeight - menuHeight - VIEWPORT_MARGIN)
    );
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, anchorRect.right - ACTION_MENU_WIDTH),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - ACTION_MENU_WIDTH - VIEWPORT_MARGIN)
    );

    setPosition({ top, left, ready: true });
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
      className="fixed w-44 bg-[#0d0d0d] border border-[#282828] rounded shadow-2xl py-1 z-[100] text-xs text-left"
      style={{
        top: position.top,
        left: position.left,
        visibility: position.ready ? 'visible' : 'hidden'
      }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => runAction(() => onSelectSite(site))}
        className="w-full px-3 py-1.5 text-neutral-200 hover:bg-[#1a1a1a] flex items-center gap-2"
      >
        <Eye className="w-3.5 h-3.5" />
        Ver detalhes
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => runAction(() => onCheckSiteNow(site.id))}
        disabled={checkingSiteId === site.id}
        className="w-full px-3 py-1.5 text-neutral-200 hover:bg-[#1a1a1a] flex items-center gap-2 disabled:opacity-50"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${checkingSiteId === site.id ? 'animate-spin text-emerald-400' : ''}`} />
        {checkingSiteId === site.id ? 'Verificando...' : 'Verificar agora'}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => runAction(() => onEditSite(site))}
        className="w-full px-3 py-1.5 text-neutral-200 hover:bg-[#1a1a1a] flex items-center gap-2"
      >
        <Edit3 className="w-3.5 h-3.5" />
        Editar
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => runAction(() => onTogglePause(site.id))}
        className="w-full px-3 py-1.5 text-neutral-200 hover:bg-[#1a1a1a] flex items-center gap-2"
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
      <div className="border-t border-[#1e1e1e] my-1" />
      <button
        type="button"
        role="menuitem"
        onClick={() => runAction(() => onDeleteSite(site.id))}
        className="w-full px-3 py-1.5 text-rose-400 hover:bg-rose-950/30 flex items-center gap-2"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Excluir
      </button>
    </div>,
    document.body
  );
};

export const SitesView: React.FC<SitesViewProps> = ({
  sites,
  onAddSite,
  onSelectSite,
  onEditSite,
  onTogglePause,
  onDeleteSite,
  onCheckSiteNow,
  checkingSiteId = null
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SiteStatus>('all');
  const [hostingFilter, setHostingFilter] = useState<string>('all');
  const [activeMenuSiteId, setActiveMenuSiteId] = useState<string | null>(null);
  const [activeMenuAnchor, setActiveMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState(1);

  const hostingList = useMemo(() => {
    const list = Array.from(new Set(sites.map(s => s.hosting)));
    return ['all', ...list];
  }, [sites]);

  const filteredSites = useMemo(() => {
    return sites
      .filter((s) => {
        if (statusFilter !== 'all' && s.status !== statusFilter) return false;
        if (hostingFilter !== 'all' && s.hosting !== hostingFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return (
            s.client.toLowerCase().includes(q) ||
            s.domain.toLowerCase().includes(q) ||
            s.siteName.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        const priority: Record<SiteStatus, number> = { critical: 1, offline: 2, warning: 3, security_blocked: 3, online: 4, unknown: 5, paused: 6 };
        return priority[a.status] - priority[b.status];
      });
  }, [sites, statusFilter, hostingFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredSites.length / pageSize));
  const paginatedSites = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredSites.slice(start, start + pageSize);
  }, [currentPage, filteredSites, pageSize]);
  const activeMenuSite = activeMenuSiteId
    ? filteredSites.find((site) => site.id === activeMenuSiteId) ?? null
    : null;
  const firstVisibleResult = filteredSites.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastVisibleResult = Math.min(currentPage * pageSize, filteredSites.length);

  useEffect(() => {
    setCurrentPage(1);
    setActiveMenuSiteId(null);
    setActiveMenuAnchor(null);
  }, [hostingFilter, pageSize, searchQuery, statusFilter]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const closeActionsMenu = useCallback(() => {
    setActiveMenuSiteId(null);
    setActiveMenuAnchor(null);
  }, []);

  const exportCSV = () => {
    const headers = ['Cliente', 'Site', 'URL', 'Domínio', 'Hospedagem', 'Status', 'Uptime', 'Resposta', 'SSL_Dias', 'Dominio_Dias'];
    const rows = filteredSites.map(s => [
      `"${s.client}"`,
      `"${s.siteName}"`,
      `"${s.url}"`,
      `"${s.domain}"`,
      `"${s.hosting}"`,
      siteStatusLabel(s.status),
      s.uptime30d === null ? 'Sem dados suficientes' : s.uptime30dReliable ? `${s.uptime30d}%` : `Histórico parcial (${s.uptime30d}%)`,
      s.responseTime === null ? responseTimeUnavailableLabel(s) : `${s.responseTime}s`,
      s.sslDaysRemaining ?? sslUnavailableLabel(s),
      s.domainDaysRemaining ?? domainUnavailableLabel(s)
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `tecnihub_sites_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-[#1e1e1e]">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-sans">
            Inventário de Sites
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">
            Gestão completa de todos os domínios e serviços dos clientes da TECNIHUB ({sites.length} cadastrados).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="px-3 py-1.5 text-xs font-medium bg-[#111111] hover:bg-[#1a1a1a] text-neutral-300 border border-[#222222] rounded transition-colors flex items-center gap-1.5"
            title="Exportar inventário para CSV"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar CSV
          </button>

          <button
            onClick={onAddSite}
            className="px-3 py-1.5 text-xs font-semibold bg-white text-black hover:bg-neutral-200 rounded transition-colors shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar site
          </button>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por cliente, domínio ou nome do projeto..."
            className="w-full pl-9 pr-3 py-1.5 bg-[#000000] border border-[#222222] rounded text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500 transition-colors"
          />
        </div>

        {/* Status & Hosting dropdowns */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-2.5 py-1.5 bg-[#000000] border border-[#222222] rounded text-xs text-white focus:outline-none focus:border-neutral-500 font-mono"
          >
            <option value="all">Todos os Status</option>
            <option value="online">Online</option>
            <option value="warning">Atenção</option>
            <option value="critical">Crítico</option>
            <option value="offline">Offline</option>
            <option value="paused">Pausado</option>
          </select>

          <select
            value={hostingFilter}
            onChange={(e) => setHostingFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-[#000000] border border-[#222222] rounded text-xs text-white focus:outline-none focus:border-neutral-500 font-mono"
          >
            <option value="all">Todas as Hospedagens</option>
            {hostingList.filter(h => h !== 'all').map(h => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Full Table or Empty State */}
      {sites.length === 0 ? (
        <div className="p-8 text-center bg-[#0a0a0a] border border-[#1e1e1e] rounded shadow-xs">
          <div className="w-10 h-10 rounded-full bg-[#141414] border border-[#222222] flex items-center justify-center mx-auto mb-3 text-neutral-400">
            <Globe className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-white font-sans mb-1">
            Nenhum site cadastrado.
          </h3>
          <p className="text-xs text-neutral-400 font-mono max-w-md mx-auto mb-4">
            Adicione o primeiro site da sua carteira para gerenciar domínios, SSL e status HTTP.
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
        <div className="rounded border border-[#1e1e1e] bg-[#0a0a0a] overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#1e1e1e] bg-[#000000] text-[9px] font-mono uppercase tracking-wider text-neutral-400">
                  <th className="py-2.5 px-3 font-semibold">Cliente / Projeto</th>
                  <th className="py-2.5 px-3 font-semibold">URL & Domínio</th>
                  <th className="py-2.5 px-3 font-semibold">Hospedagem</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 px-3 font-semibold">Uptime 30d</th>
                  <th className="py-2.5 px-3 font-semibold">Tempo Resposta</th>
                  <th className="py-2.5 px-3 font-semibold">Validade SSL</th>
                  <th className="py-2.5 px-3 font-semibold">Validade Domínio</th>
                  <th className="py-2.5 px-2.5 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#181818] font-sans">
                {filteredSites.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-neutral-500 text-xs font-mono">
                      Nenhum site encontrado com os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                paginatedSites.map((site) => {
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
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="font-semibold text-white text-xs">{site.client}</div>
                        <div className="text-[10px] text-neutral-400">{site.siteName}</div>
                      </td>

                      {/* URL / Domínio */}
                      <td className="py-2.5 px-3 font-mono text-neutral-300 whitespace-nowrap">
                        <span className="text-[11px] text-white block">{site.domain}</span>
                        <span className="text-[9px] text-neutral-500">{site.url}</span>
                      </td>

                      {/* Hospedagem */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#161616] text-neutral-300 border border-[#222222]">
                          {site.hosting}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3 whitespace-nowrap font-mono text-[11px]">
                        {site.status === 'online' && (
                          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Online
                          </span>
                        )}
                        {site.status === 'warning' && (
                          <span className="inline-flex items-center gap-1.5 font-medium text-amber-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                            Atenção
                          </span>
                        )}
                        {site.status === 'offline' && (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-rose-400">
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
                          <span className="inline-flex items-center gap-1.5 font-semibold text-rose-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                            Falha crítica
                          </span>
                        )}
                        {site.status === 'paused' && (
                          <span className="inline-flex items-center gap-1.5 font-medium text-neutral-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-neutral-600" />
                            Pausado
                          </span>
                        )}
                        {site.status === 'unknown' && (
                          <span className="inline-flex items-center gap-1.5 font-medium text-neutral-500">
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

                      {/* Ações */}
                      <td 
                        className="py-2.5 px-2.5 text-right whitespace-nowrap"
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

                          <div>
                            <button
                              type="button"
                              aria-haspopup="menu"
                              aria-expanded={activeMenuSiteId === site.id}
                              aria-label={`Abrir ações de ${site.siteName}`}
                              onClick={(event) => {
                                if (activeMenuSiteId === site.id) {
                                  closeActionsMenu();
                                } else {
                                  setActiveMenuSiteId(site.id);
                                  setActiveMenuAnchor(event.currentTarget);
                                }
                              }}
                              className="p-1 text-neutral-400 hover:text-white rounded hover:bg-[#181818] transition-colors"
                            >
                              <MoreVertical className="w-3 h-3" />
                            </button>
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
          <div className="border-t border-[#1e1e1e] px-3 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-[11px] text-neutral-400">
            <div className="flex items-center gap-2">
              <label htmlFor="sites-page-size">Mostrar</label>
              <select
                id="sites-page-size"
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="px-2 py-1 bg-black border border-[#282828] rounded text-white focus:outline-none focus:border-neutral-500"
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <span>por página</span>
              <span className="text-neutral-600 hidden sm:inline">•</span>
              <span className="hidden sm:inline">
                {firstVisibleResult}–{lastVisibleResult} de {filteredSites.length}
              </span>
            </div>

            {totalPages > 1 && (
              <nav className="flex items-center gap-1" aria-label="Paginação dos sites">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage === 1}
                  className="px-2 py-1 rounded border border-[#282828] text-neutral-300 hover:bg-[#181818] disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Anterior
                </button>
                {getVisiblePages(currentPage, totalPages).map((page) => (
                  typeof page === 'number' ? (
                    <button
                      key={page}
                      type="button"
                      onClick={() => setCurrentPage(page)}
                      aria-current={currentPage === page ? 'page' : undefined}
                      className={`min-w-7 px-2 py-1 rounded border transition-colors ${
                        currentPage === page
                          ? 'bg-white text-black border-white font-semibold'
                          : 'border-[#282828] text-neutral-300 hover:bg-[#181818]'
                      }`}
                    >
                      {page}
                    </button>
                  ) : (
                    <span key={page} className="px-1 text-neutral-600" aria-hidden="true">…</span>
                  )
                ))}
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={currentPage === totalPages}
                  className="px-2 py-1 rounded border border-[#282828] text-neutral-300 hover:bg-[#181818] disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Próxima
                </button>
              </nav>
            )}
          </div>
      </div>
    )}
    {activeMenuSite && activeMenuAnchor && (
      <SiteActionsMenu
        anchor={activeMenuAnchor}
        site={activeMenuSite}
        checkingSiteId={checkingSiteId}
        onClose={closeActionsMenu}
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
