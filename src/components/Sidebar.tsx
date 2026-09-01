import React from 'react';
import { 
  LayoutDashboard, 
  Globe, 
  AlertOctagon, 
  Bell, 
  BarChart3, 
  Settings, 
  Radio, 
  ChevronRight,
  ShieldCheck,
  X,
  LogOut
} from 'lucide-react';
import { NavigationTab } from '../types';
import { TecnihubLogo } from './TecnihubLogo';

interface SidebarProps {
  currentTab: NavigationTab;
  onNavigate: (tab: NavigationTab) => void;
  activeIncidentsCount: number;
  offlineCount: number;
  warningCount: number;
  onlineCount: number;
  pausedCount: number;
  unknownCount: number;
  totalSitesCount: number;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  adminEmail: string;
  onLogout: () => void;
  isLoggingOut: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onNavigate,
  activeIncidentsCount,
  offlineCount,
  warningCount,
  onlineCount,
  pausedCount,
  unknownCount,
  totalSitesCount,
  isOpenMobile,
  onCloseMobile,
  adminEmail,
  onLogout,
  isLoggingOut
}) => {
  const menuItems = [
    {
      id: 'dashboard' as NavigationTab,
      label: 'Dashboard',
      icon: LayoutDashboard,
      badge: offlineCount > 0 ? (
        <span className="flex items-center gap-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
          {offlineCount}
        </span>
      ) : null
    },
    {
      id: 'sites' as NavigationTab,
      label: 'Sites',
      icon: Globe,
      badge: (
        <span className="text-[11px] font-mono text-neutral-500 font-medium px-1.5 py-0.5 rounded bg-neutral-800/80">
          {totalSitesCount}
        </span>
      )
    },
    {
      id: 'incidents' as NavigationTab,
      label: 'Incidentes',
      icon: AlertOctagon,
      badge: activeIncidentsCount > 0 ? (
        <span className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
          {activeIncidentsCount}
        </span>
      ) : null
    },
    {
      id: 'alerts' as NavigationTab,
      label: 'Alertas',
      icon: Bell,
      badge: null
    },
    {
      id: 'reports' as NavigationTab,
      label: 'Relatórios',
      icon: BarChart3,
      badge: null
    },
    {
      id: 'settings' as NavigationTab,
      label: 'Configurações',
      icon: Settings,
      badge: null
    }
  ];

  const handleSelect = (tab: NavigationTab) => {
    onNavigate(tab);
    onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div 
          onClick={onCloseMobile}
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 lg:hidden"
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 w-60 bg-[#050505] border-r border-[#1e1e1e] flex flex-col transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="h-14 px-4 border-b border-[#1e1e1e] flex items-center justify-between bg-[#000000]">
          <TecnihubLogo size="sm" />
          <button
            onClick={onCloseMobile}
            className="lg:hidden p-1 text-neutral-400 hover:text-white rounded hover:bg-[#1a1a1a] transition-colors"
            title="Fechar menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Agency Environment Indicator */}
        <div className="px-3.5 py-2 border-b border-[#181818] bg-[#080808] flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
            </span>
            <span className="text-[10px] font-mono text-neutral-400 uppercase tracking-wider font-semibold">
              Painel Operacional
            </span>
          </div>
          <span className="text-[9px] font-mono text-neutral-400 px-1 py-0.2 rounded bg-[#121212] border border-[#222222]">
            MVP
          </span>
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 px-2.5 py-2.5 space-y-0.5 overflow-y-auto">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id || (currentTab === 'site-detail' && item.id === 'sites');

            return (
              <button
                key={item.id}
                onClick={() => handleSelect(item.id)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-[11px] font-medium transition-all group ${
                  isActive
                    ? 'bg-[#1c1c1c] text-white font-semibold border border-[#2e2e2e] shadow-xs'
                    : 'text-neutral-400 hover:text-neutral-100 hover:bg-[#111111] border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={`w-3.5 h-3.5 transition-colors ${
                    isActive ? 'text-white' : 'text-neutral-400 group-hover:text-neutral-200'
                  }`} />
                  <span className="tracking-tight">{item.label}</span>
                </div>
                <div className="flex items-center gap-1">
                  {item.badge}
                  {!isActive && (
                    <ChevronRight className="w-2.5 h-2.5 text-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </div>
              </button>
            );
          })}
        </nav>

        {/* Quick Health Status Footer */}
        <div className="p-3 m-2.5 rounded bg-[#0a0a0a] border border-[#1e1e1e]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono font-semibold text-neutral-400 uppercase tracking-wider">
              Status Geral
            </span>
            {totalSitesCount === 0 ? (
              <span className="inline-flex items-center gap-1 text-[9px] text-neutral-500 font-mono">
                Sem sites
              </span>
            ) : offlineCount > 0 || warningCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-[9px] text-amber-400 font-mono">
                <Radio className="w-2.5 h-2.5 animate-pulse" />
                Atenção
              </span>
            ) : unknownCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-[9px] text-neutral-400 font-mono">
                Dados pendentes
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[9px] text-emerald-400 font-mono">
                <ShieldCheck className="w-2.5 h-2.5" />
                Sem falhas ativas
              </span>
            )}
          </div>
          
          <div className="space-y-1 text-[10px] font-mono">
            <div className="flex justify-between items-center text-neutral-300">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Operacionais
              </span>
              <span className="font-bold text-emerald-400">{onlineCount}</span>
            </div>
            {warningCount > 0 && (
              <div className="flex justify-between items-center text-neutral-300">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                  Sob Alerta
                </span>
                <span className="font-bold text-amber-400">{warningCount}</span>
              </div>
            )}
            {offlineCount > 0 && (
              <div className="flex justify-between items-center text-neutral-300">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                  Indisponíveis
                </span>
                <span className="font-bold text-rose-400">{offlineCount}</span>
              </div>
            )}
            {pausedCount > 0 && (
              <div className="flex justify-between items-center text-neutral-300">
                <span>Pausados</span>
                <span className="font-bold text-neutral-400">{pausedCount}</span>
              </div>
            )}
            {unknownCount > 0 && (
              <div className="flex justify-between items-center text-neutral-300">
                <span>Sem dados</span>
                <span className="font-bold text-neutral-400">{unknownCount}</span>
              </div>
            )}
          </div>
        </div>

        {/* Agency Account Card */}
        <div className="px-3 py-2.5 border-t border-[#1e1e1e] bg-[#000000] flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded bg-[#141414] border border-[#2a2a2a] flex items-center justify-center font-bold text-[10px] text-neutral-300 font-mono shrink-0">
              TH
            </div>
            <div className="truncate">
              <p className="text-[11px] font-semibold text-neutral-200 truncate">Equipe Tecnihub</p>
              <p className="text-[9px] text-neutral-500 font-mono truncate">{adminEmail}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            disabled={isLoggingOut}
            className="p-1.5 rounded text-neutral-500 hover:text-white hover:bg-[#181818] disabled:opacity-50 transition-colors"
            title="Sair do painel"
            aria-label="Sair do painel"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>
    </>
  );
};
