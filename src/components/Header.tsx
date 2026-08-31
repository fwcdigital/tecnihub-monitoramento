import React, { useState } from 'react';
import { 
  Menu, 
  Bell, 
  RefreshCw, 
  Plus, 
  ShieldAlert, 
  CheckCircle2, 
  AlertTriangle,
  Globe,
  Radio
} from 'lucide-react';
import { NavigationTab, Incident } from '../types';

interface HeaderProps {
  currentTab: NavigationTab;
  onOpenMobileMenu: () => void;
  onAddSite: () => void;
  incidents: Incident[];
  onSelectIncident: (incident: Incident) => void;
  isCheckingAll: boolean;
  onCheckAll: () => void;
  offlineCount: number;
  warningCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onOpenMobileMenu,
  onAddSite,
  incidents,
  onSelectIncident,
  isCheckingAll,
  onCheckAll,
  offlineCount,
  warningCount
}) => {
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const tabTitles: Record<NavigationTab, { title: string; subtitle: string }> = {
    dashboard: { title: 'Dashboard Geral', subtitle: 'Visão operacional em tempo real' },
    sites: { title: 'Todos os Sites', subtitle: 'Inventário completo de domínios e serviços' },
    incidents: { title: 'Incidentes', subtitle: 'Histórico e anomalias ativas' },
    alerts: { title: 'Alertas & Canais', subtitle: 'Regras de notificação e gatilhos' },
    reports: { title: 'Relatórios Operacionais', subtitle: 'Métricas de disponibilidade e estabilidade' },
    settings: { title: 'Configurações', subtitle: 'Parâmetros internos do sistema' },
    'site-detail': { title: 'Detalhes do Site', subtitle: 'Telemetria e logs específicos' }
  };

  const activeIncidents = incidents.filter(i => i.status === 'active');

  return (
    <header className="h-14 px-3.5 sm:px-6 bg-[#000000]/95 backdrop-blur-md border-b border-[#1e1e1e] sticky top-0 z-30 flex items-center justify-between">
      
      {/* Left: Mobile Toggle & Page Title */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-1.5 text-neutral-400 hover:text-white rounded hover:bg-[#181818] transition-colors"
          title="Abrir menu"
        >
          <Menu className="w-4 h-4" />
        </button>

        <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono text-neutral-400">
          <span className="text-neutral-500 font-semibold tracking-wider">TECNIHUB</span>
          <span className="text-neutral-700">/</span>
          <span className="text-white font-medium">{tabTitles[currentTab]?.title}</span>
        </div>
      </div>

      {/* Right: Quick Global Status + Notifications + Actions */}
      <div className="flex items-center gap-2 sm:gap-3">
        
        {/* Quick status pill */}
        <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded bg-[#0a0a0a] border border-[#222222] text-[10px] font-mono">
          <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Operacional
          </span>
          {offlineCount > 0 && (
            <>
              <span className="text-neutral-700">•</span>
              <span className="flex items-center gap-1.5 text-rose-400 font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                {offlineCount} Crítico
              </span>
            </>
          )}
        </div>

        {/* Global check button */}
        <button
          onClick={onCheckAll}
          disabled={isCheckingAll}
          className="p-1.5 text-neutral-400 hover:text-white rounded bg-[#0a0a0a] border border-[#222222] hover:bg-[#181818] transition-colors disabled:opacity-50"
          title="Executar verificação imediata de todos os sites"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isCheckingAll ? 'animate-spin text-white' : ''}`} />
        </button>

        {/* Notifications Dropdown */}
        <div className="relative">
          <button
            onClick={() => setNotificationsOpen(!notificationsOpen)}
            className="p-1.5 text-neutral-400 hover:text-white rounded bg-[#0a0a0a] border border-[#222222] hover:bg-[#181818] transition-colors relative"
            title="Notificações de incidentes"
          >
            <Bell className="w-3.5 h-3.5" />
            {activeIncidents.length > 0 && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>

          {notificationsOpen && (
            <div className="absolute right-0 mt-1.5 w-80 bg-[#0a0a0a] border border-[#262626] rounded shadow-2xl py-1.5 z-40">
              <div className="px-3.5 py-2 border-b border-[#1e1e1e] flex items-center justify-between bg-[#000000]">
                <span className="text-[11px] font-bold text-white uppercase tracking-wider font-mono">
                  Ocorrências Ativas ({activeIncidents.length})
                </span>
                <span className="text-[9px] font-mono text-neutral-500">Tempo Real</span>
              </div>

              <div className="max-h-72 overflow-y-auto divide-y divide-[#1a1a1a] text-xs">
                {activeIncidents.length === 0 ? (
                  <div className="p-4 text-center text-neutral-500 text-[11px]">
                    Nenhum incidente ativo no momento. Todos os sites operando normalmente.
                  </div>
                ) : (
                  activeIncidents.map((inc) => (
                    <div
                      key={inc.id}
                      onClick={() => {
                        onSelectIncident(inc);
                        setNotificationsOpen(false);
                      }}
                      className="p-2.5 hover:bg-[#141414] cursor-pointer transition-colors"
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span className="font-bold text-neutral-300">{inc.client}</span>
                        <span className="text-neutral-500">{inc.createdAt}</span>
                      </div>
                      <p className="text-white font-medium text-xs mt-0.5">{inc.type}</p>
                      <p className="text-neutral-400 text-[10px] font-mono mt-0.5 truncate">{inc.currentStatus}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Add Site Button */}
        <button
          onClick={onAddSite}
          className="px-3 py-1.5 text-xs font-semibold bg-white text-black hover:bg-neutral-200 rounded transition-colors shadow-xs flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Adicionar Site</span>
        </button>
      </div>
    </header>
  );
};
