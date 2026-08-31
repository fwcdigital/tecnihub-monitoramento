import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Plus, 
  Filter, 
  RefreshCw, 
  ExternalLink, 
  MoreVertical, 
  Eye, 
  Edit3, 
  PauseCircle, 
  PlayCircle, 
  Trash2,
  Globe,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Download
} from 'lucide-react';
import { Site, SiteStatus, HostingProvider } from '../types';

interface SitesViewProps {
  sites: Site[];
  onAddSite: () => void;
  onSelectSite: (site: Site) => void;
  onEditSite: (site: Site) => void;
  onTogglePause: (siteId: string) => void;
  onDeleteSite: (siteId: string) => void;
  onCheckSiteNow: (siteId: string) => void;
}

export const SitesView: React.FC<SitesViewProps> = ({
  sites,
  onAddSite,
  onSelectSite,
  onEditSite,
  onTogglePause,
  onDeleteSite,
  onCheckSiteNow
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SiteStatus>('all');
  const [hostingFilter, setHostingFilter] = useState<string>('all');
  const [activeMenuSiteId, setActiveMenuSiteId] = useState<string | null>(null);

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
        const priority: Record<SiteStatus, number> = { offline: 1, warning: 2, online: 3, paused: 4 };
        return priority[a.status] - priority[b.status];
      });
  }, [sites, statusFilter, hostingFilter, searchQuery]);

  const exportCSV = () => {
    const headers = ['Cliente', 'Site', 'URL', 'Domínio', 'Hospedagem', 'Status', 'Uptime', 'Resposta', 'SSL_Dias', 'Dominio_Dias'];
    const rows = filteredSites.map(s => [
      `"${s.client}"`,
      `"${s.siteName}"`,
      `"${s.url}"`,
      `"${s.domain}"`,
      `"${s.hosting}"`,
      s.status,
      `${s.uptime30d}%`,
      `${s.responseTime}s`,
      s.sslDaysRemaining,
      s.domainDaysRemaining
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

      {/* Full Table - High Density */}
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
                filteredSites.map((site) => {
                  const isOffline = site.status === 'offline';
                  const isWarning = site.status === 'warning';
                  const isPaused = site.status === 'paused';

                  return (
                    <tr
                      key={site.id}
                      className={`hover:bg-[#121212] transition-colors group cursor-pointer ${
                        isOffline ? 'bg-rose-950/20' : isWarning ? 'bg-amber-950/15' : ''
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
                            Offline (503)
                          </span>
                        )}
                        {site.status === 'paused' && (
                          <span className="inline-flex items-center gap-1.5 font-medium text-neutral-500">
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

                      {/* Ações */}
                      <td 
                        className="py-2.5 px-2.5 text-right whitespace-nowrap"
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
                              onClick={() => setActiveMenuSiteId(activeMenuSiteId === site.id ? null : site.id)}
                              className="p-1 text-neutral-400 hover:text-white rounded hover:bg-[#181818] transition-colors"
                            >
                              <MoreVertical className="w-3 h-3" />
                            </button>

                            {activeMenuSiteId === site.id && (
                              <div className="absolute right-0 mt-1 w-44 bg-[#0d0d0d] border border-[#282828] rounded shadow-xl py-1 z-30 text-xs text-left">
                                <button
                                  onClick={() => {
                                    onSelectSite(site);
                                    setActiveMenuSiteId(null);
                                  }}
                                  className="w-full px-3 py-1.5 text-neutral-200 hover:bg-[#1a1a1a] flex items-center gap-2"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  Ver detalhes
                                </button>
                                <button
                                  onClick={() => {
                                    onCheckSiteNow(site.id);
                                    setActiveMenuSiteId(null);
                                  }}
                                  className="w-full px-3 py-1.5 text-neutral-200 hover:bg-[#1a1a1a] flex items-center gap-2"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                  Verificar agora
                                </button>
                                <button
                                  onClick={() => {
                                    onEditSite(site);
                                    setActiveMenuSiteId(null);
                                  }}
                                  className="w-full px-3 py-1.5 text-neutral-200 hover:bg-[#1a1a1a] flex items-center gap-2"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                  Editar
                                </button>
                                <button
                                  onClick={() => {
                                    onTogglePause(site.id);
                                    setActiveMenuSiteId(null);
                                  }}
                                  className="w-full px-3 py-1.5 text-neutral-200 hover:bg-[#1a1a1a] flex items-center gap-2"
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
                                <div className="border-t border-[#1e1e1e] my-1"></div>
                                <button
                                  onClick={() => {
                                    onDeleteSite(site.id);
                                    setActiveMenuSiteId(null);
                                  }}
                                  className="w-full px-3 py-1.5 text-rose-400 hover:bg-rose-950/30 flex items-center gap-2"
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
  );
};
