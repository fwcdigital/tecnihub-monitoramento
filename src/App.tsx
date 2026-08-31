import React, { useState, useEffect, useCallback } from 'react';
import { 
  Site, 
  Incident, 
  AlertRule, 
  FalseAlarmConfig, 
  NavigationTab 
} from './types';
import { 
  INITIAL_SITES, 
  INITIAL_INCIDENTS, 
  INITIAL_ALERT_RULES, 
  INITIAL_FALSE_ALARM_CONFIG 
} from './data/mockData';
import { analyzeSiteTracking } from './utils/trackingAnalyzer';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { SitesView } from './components/SitesView';
import { SiteDetailView } from './components/SiteDetailView';
import { IncidentsView } from './components/IncidentsView';
import { AlertsView } from './components/AlertsView';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { AddEditSiteModal } from './components/AddEditSiteModal';
import { IncidentDetailModal } from './components/IncidentDetailModal';
import { ToastContainer, ToastMessage } from './components/Toast';

export default function App() {
  // Navigation State
  const [currentTab, setCurrentTab] = useState<NavigationTab>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Core Data State (Loaded from localStorage or initialized from rich defaults)
  const [sites, setSites] = useState<Site[]>(() => {
    try {
      const saved = localStorage.getItem('tecnihub_sites_v1');
      if (saved) return JSON.parse(saved);
    } catch {}
    return INITIAL_SITES;
  });

  const [incidents, setIncidents] = useState<Incident[]>(() => {
    try {
      const saved = localStorage.getItem('tecnihub_incidents_v1');
      if (saved) return JSON.parse(saved);
    } catch {}
    return INITIAL_INCIDENTS;
  });

  const [alertRules, setAlertRules] = useState<AlertRule[]>(() => {
    try {
      const saved = localStorage.getItem('tecnihub_alerts_v1');
      if (saved) return JSON.parse(saved);
    } catch {}
    return INITIAL_ALERT_RULES;
  });

  const [falseAlarmConfig, setFalseAlarmConfig] = useState<FalseAlarmConfig>(() => {
    try {
      const saved = localStorage.getItem('tecnihub_false_alarm_v1');
      if (saved) return JSON.parse(saved);
    } catch {}
    return INITIAL_FALSE_ALARM_CONFIG;
  });

  // Modal States
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [siteToEdit, setSiteToEdit] = useState<Site | null>(null);
  const [selectedSiteDetail, setSelectedSiteDetail] = useState<Site | null>(null);
  const [selectedIncidentDetail, setSelectedIncidentDetail] = useState<Incident | null>(null);
  const [isIncidentModalOpen, setIsIncidentModalOpen] = useState(false);

  // Checking / Async States
  const [isCheckingAll, setIsCheckingAll] = useState(false);
  const [checkingSiteId, setCheckingSiteId] = useState<string | null>(null);

  // Toast Notifications
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((type: ToastMessage['type'], title: string, message?: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Save to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('tecnihub_sites_v1', JSON.stringify(sites));
    } catch {}
  }, [sites]);

  useEffect(() => {
    try {
      localStorage.setItem('tecnihub_incidents_v1', JSON.stringify(incidents));
    } catch {}
  }, [incidents]);

  useEffect(() => {
    try {
      localStorage.setItem('tecnihub_alerts_v1', JSON.stringify(alertRules));
    } catch {}
  }, [alertRules]);

  useEffect(() => {
    try {
      localStorage.setItem('tecnihub_false_alarm_v1', JSON.stringify(falseAlarmConfig));
    } catch {}
  }, [falseAlarmConfig]);

  // Keep selectedSiteDetail synchronized with sites updates
  useEffect(() => {
    if (selectedSiteDetail) {
      const updated = sites.find((s) => s.id === selectedSiteDetail.id);
      if (updated) {
        setSelectedSiteDetail(updated);
      }
    }
  }, [sites]);

  // Counters
  const offlineCount = sites.filter((s) => s.status === 'offline').length;
  const warningCount = sites.filter((s) => s.status === 'warning').length;
  const activeIncidentsCount = incidents.filter((i) => i.status === 'active').length;

  // Actions
  const handleOpenAddSite = () => {
    setSiteToEdit(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEditSite = (site: Site) => {
    setSiteToEdit(site);
    setIsAddModalOpen(true);
  };

  const handleSaveSite = (siteData: Partial<Site>) => {
    if (siteToEdit) {
      // Edit existing
      setSites((prev) =>
        prev.map((s) => (s.id === siteToEdit.id ? { ...s, ...siteData } : s))
      );
      addToast('success', 'Site atualizado', `As configurações de ${siteData.siteName || siteToEdit.siteName} foram salvas.`);
    } else {
      // Add new site
      const newId = `site-${Date.now()}`;
      const newSite: Site = {
        id: newId,
        client: siteData.client || 'Novo Cliente',
        siteName: siteData.siteName || 'Novo Site',
        url: siteData.url || 'https://exemplo.com.br',
        domain: siteData.domain || 'exemplo.com.br',
        hosting: siteData.hosting || 'Hostinger',
        frequency: siteData.frequency || '5min',
        status: 'online',
        uptime30d: 100.0,
        responseTime: 0.85,
        avgResponseTime: 0.85,
        sslValid: true,
        sslDaysRemaining: 90,
        domainDaysRemaining: 365,
        lastCheck: 'Agora',
        httpStatus: 200,
        monitorAvailability: siteData.monitorAvailability ?? true,
        monitorResponseTime: siteData.monitorResponseTime ?? true,
        monitorSsl: siteData.monitorSsl ?? true,
        monitorDomain: siteData.monitorDomain ?? true,
        monitorRedirects: siteData.monitorRedirects ?? true,
        monitorContent: siteData.monitorContent ?? false,
        expectedContentText: siteData.expectedContentText || '',
        consecutiveFailures: 0,
        createdAt: new Date().toISOString().slice(0, 10),
        checksHistory: [
          {
            id: `chk-${Date.now()}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            status: 'online',
            httpCode: 200,
            responseTime: 0.85,
            result: 'Site cadastrado e validado com sucesso'
          }
        ]
      };
      setSites((prev) => [newSite, ...prev]);
      addToast('success', 'Site cadastrado com sucesso', `${newSite.siteName} entrou na fila de monitoramento contínuo.`);
    }
  };

  const handleTogglePauseSite = (siteId: string) => {
    setSites((prev) =>
      prev.map((s) => {
        if (s.id === siteId) {
          const nextStatus = s.status === 'paused' ? 'online' : 'paused';
          addToast(
            nextStatus === 'paused' ? 'info' : 'success',
            nextStatus === 'paused' ? 'Monitoramento pausado' : 'Monitoramento retomado',
            `O site ${s.domain} foi ${nextStatus === 'paused' ? 'pausado' : 'reativado'}.`
          );
          return {
            ...s,
            status: nextStatus,
            lastCheck: nextStatus === 'paused' ? 'Pausado' : 'Há 1 min'
          };
        }
        return s;
      })
    );
  };

  const handleDeleteSite = (siteId: string) => {
    const site = sites.find((s) => s.id === siteId);
    if (!site) return;
    setSites((prev) => prev.filter((s) => s.id !== siteId));
    if (selectedSiteDetail?.id === siteId) {
      setSelectedSiteDetail(null);
      setCurrentTab('dashboard');
    }
    addToast('info', 'Site removido', `${site.siteName} foi excluído da monitoria.`);
  };

  // Perform single ping check
  const handleCheckSiteNow = (siteId: string) => {
    setCheckingSiteId(siteId);
    const targetSite = sites.find((s) => s.id === siteId);

    setTimeout(() => {
      setCheckingSiteId(null);
      if (!targetSite) return;

      const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      // If it's the offline site, keep or verify
      const isStillOffline = targetSite.status === 'offline';
      const isWarning = targetSite.status === 'warning';
      
      const newResponseTime = isStillOffline ? 0 : +(0.4 + Math.random() * 0.8).toFixed(2);
      const newRecord = {
        id: `chk-${Date.now()}`,
        timestamp: nowTime,
        status: targetSite.status as 'online' | 'warning' | 'offline',
        httpCode: targetSite.httpStatus,
        responseTime: newResponseTime,
        result: isStillOffline ? 'HTTP 503 Service Unavailable' : isWarning ? 'Alerta registrado' : 'Tudo normal'
      };

      setSites((prev) =>
        prev.map((s) => {
          if (s.id === siteId) {
            return {
              ...s,
              lastCheck: 'Há instantes',
              responseTime: isStillOffline ? 0 : newResponseTime,
              checksHistory: [newRecord, ...s.checksHistory.slice(0, 15)]
            };
          }
          return s;
        })
      );

      if (isStillOffline) {
        addToast('error', 'Verificação concluída: Falha persistente', `${targetSite.domain} retornou HTTP 503.`);
      } else {
        addToast('success', 'Verificação concluída com sucesso', `${targetSite.domain} respondeu em ${newResponseTime}s (HTTP 200).`);
      }
    }, 700);
  };

  // Check all sites ping
  const handleCheckAllSites = () => {
    setIsCheckingAll(true);
    setTimeout(() => {
      setIsCheckingAll(false);
      const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setSites((prev) =>
        prev.map((s) => {
          if (s.status === 'paused') return s;
          const isOff = s.status === 'offline';
          const newResp = isOff ? 0 : +(0.5 + Math.random() * 0.7).toFixed(2);
          return {
            ...s,
            lastCheck: 'Há instantes',
            responseTime: isOff ? 0 : newResp,
            checksHistory: [
              {
                id: `chk-${Date.now()}-${s.id}`,
                timestamp: nowTime,
                status: s.status as any,
                httpCode: s.httpStatus,
                responseTime: newResp,
                result: isOff ? 'HTTP 503 Service Unavailable' : 'Tudo normal'
              },
              ...s.checksHistory.slice(0, 15)
            ]
          };
        })
      );
      addToast('success', 'Varredura global finalizada', `${sites.length} sites verificados com sucesso.`);
    }, 1200);
  };

  // Select site for detailed view
  const handleSelectSite = (site: Site) => {
    setSelectedSiteDetail(site);
    setCurrentTab('site-detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Verify site tracking tags
  const handleVerifySiteTracking = (siteId: string) => {
    const site = sites.find((s) => s.id === siteId);
    if (!site) return;

    const updatedTracking = analyzeSiteTracking(site.tracking);
    setSites((prev) =>
      prev.map((s) => (s.id === siteId ? { ...s, tracking: updatedTracking } : s))
    );
    addToast('success', 'Rastreamento atualizado', `Tags e integrações de ${site.domain} verificadas com sucesso.`);
  };

  // Select incident for modal
  const handleSelectIncident = (incident: Incident) => {
    setSelectedIncidentDetail(incident);
    setIsIncidentModalOpen(true);
  };

  const handleResolveIncident = (incidentId: string) => {
    const inc = incidents.find((i) => i.id === incidentId);
    if (!inc) return;

    setIncidents((prev) =>
      prev.map((i) =>
        i.id === incidentId
          ? {
              ...i,
              status: 'resolved',
              resolvedAt: 'Hoje, ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              currentStatus: 'Resolvido e normalizado pela equipe'
            }
          : i
      )
    );

    // If site was offline, restore it to online
    setSites((prev) =>
      prev.map((s) => {
        if (s.id === inc.siteId && s.status === 'offline') {
          return {
            ...s,
            status: 'online',
            httpStatus: 200,
            responseTime: 0.84,
            consecutiveFailures: 0,
            lastCheck: 'Há instantes'
          };
        }
        return s;
      })
    );

    addToast('success', 'Incidente marcado como resolvido', `Ocorrência de ${inc.client} foi encerrada.`);
  };

  // Simulator Triggers
  const handleSimulateOutage = () => {
    setSites((prev) =>
      prev.map((s) => {
        if (s.id === 'site-xyz') {
          return {
            ...s,
            status: 'offline',
            httpStatus: 503,
            responseTime: 0,
            consecutiveFailures: 3,
            lastCheck: 'Há 1 min'
          };
        }
        return s;
      })
    );
    setIncidents((prev) => {
      const exists = prev.find((i) => i.id === 'inc-01');
      if (exists) {
        return prev.map((i) => (i.id === 'inc-01' ? { ...i, status: 'active' } : i));
      }
      return [INITIAL_INCIDENTS[0], ...prev];
    });
    addToast('error', 'Simulação de Queda Ativada', 'Cliente XYZ marcado como Offline (HTTP 503).');
    setCurrentTab('dashboard');
  };

  const handleSimulateSlowdown = () => {
    setSites((prev) =>
      prev.map((s) => {
        if (s.id === 'site-torge') {
          return {
            ...s,
            status: 'warning',
            responseTime: 5.74,
            lastCheck: 'Há 2 min'
          };
        }
        return s;
      })
    );
    addToast('warning', 'Simulação de Lentidão Ativada', 'Torge Sistemas com tempo de resposta em 5,74s.');
    setCurrentTab('dashboard');
  };

  const handleRestoreAllHealthy = () => {
    setSites((prev) =>
      prev.map((s) => ({
        ...s,
        status: 'online',
        httpStatus: 200,
        responseTime: +(0.5 + Math.random() * 0.4).toFixed(2),
        sslDaysRemaining: Math.max(s.sslDaysRemaining, 65),
        domainDaysRemaining: Math.max(s.domainDaysRemaining, 120),
        consecutiveFailures: 0,
        lastCheck: 'Há instantes'
      }))
    );
    setIncidents((prev) =>
      prev.map((i) => ({
        ...i,
        status: 'resolved',
        resolvedAt: 'Agora',
        currentStatus: 'Resolvido - normalizado'
      }))
    );
    addToast('success', 'Todos os sites restaurados', '100% da carteira de sites operando em estado saudável (Online).');
    setCurrentTab('dashboard');
  };

  const handleResetToDefaults = () => {
    setSites(INITIAL_SITES);
    setIncidents(INITIAL_INCIDENTS);
    setAlertRules(INITIAL_ALERT_RULES);
    setFalseAlarmConfig(INITIAL_FALSE_ALARM_CONFIG);
    localStorage.removeItem('tecnihub_sites_v1');
    localStorage.removeItem('tecnihub_incidents_v1');
    localStorage.removeItem('tecnihub_alerts_v1');
    localStorage.removeItem('tecnihub_false_alarm_v1');
    addToast('info', 'Base de dados resetada', '15 sites e incidentes restaurados aos valores padrão.');
    setCurrentTab('dashboard');
  };

  const handleSendTestAlert = (channel: string) => {
    addToast('info', 'Alerta de Teste Disparado', `Mensagem simulada enviada com sucesso para ${channel}.`);
  };

  return (
    <div className="min-h-screen bg-[#000000] text-[#FFFFFF] flex flex-col antialiased selection:bg-neutral-800 selection:text-white">
      
      {/* Lateral Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onNavigate={(tab) => {
          if (tab !== 'site-detail') setSelectedSiteDetail(null);
          setCurrentTab(tab);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        activeIncidentsCount={activeIncidentsCount}
        offlineCount={offlineCount}
        warningCount={warningCount}
        totalSitesCount={sites.length}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />

      {/* Main Content Area (offset by sidebar width on desktop) */}
      <div className="lg:pl-60 flex-1 flex flex-col min-w-0 bg-[#000000]">
        
        {/* Sticky Top Header */}
        <Header
          currentTab={currentTab}
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          onAddSite={handleOpenAddSite}
          incidents={incidents}
          onSelectIncident={handleSelectIncident}
          isCheckingAll={isCheckingAll}
          onCheckAll={handleCheckAllSites}
          offlineCount={offlineCount}
          warningCount={warningCount}
        />

        {/* Dynamic Main Body View - High Density Spacing */}
        <main className="flex-1 p-3.5 sm:p-5 lg:p-6 max-w-[1600px] w-full mx-auto">
          {currentTab === 'dashboard' && (
            <DashboardView
              sites={sites}
              incidents={incidents}
              onAddSite={handleOpenAddSite}
              onSelectSite={handleSelectSite}
              onEditSite={handleOpenEditSite}
              onTogglePause={handleTogglePauseSite}
              onDeleteSite={handleDeleteSite}
              onCheckSiteNow={handleCheckSiteNow}
              onSelectIncident={handleSelectIncident}
              isCheckingAll={isCheckingAll}
              onCheckAllSites={handleCheckAllSites}
            />
          )}

          {currentTab === 'sites' && (
            <SitesView
              sites={sites}
              onAddSite={handleOpenAddSite}
              onSelectSite={handleSelectSite}
              onEditSite={handleOpenEditSite}
              onTogglePause={handleTogglePauseSite}
              onDeleteSite={handleDeleteSite}
              onCheckSiteNow={handleCheckSiteNow}
            />
          )}

          {currentTab === 'site-detail' && selectedSiteDetail && (
            <SiteDetailView
              site={selectedSiteDetail}
              onBack={() => {
                setSelectedSiteDetail(null);
                setCurrentTab('dashboard');
              }}
              onCheckNow={handleCheckSiteNow}
              onEdit={handleOpenEditSite}
              onTogglePause={handleTogglePauseSite}
              onVerifyTracking={handleVerifySiteTracking}
              isChecking={checkingSiteId === selectedSiteDetail.id}
            />
          )}

          {currentTab === 'incidents' && (
            <IncidentsView
              incidents={incidents}
              onSelectIncident={handleSelectIncident}
              onResolveIncident={handleResolveIncident}
              onRecheckSite={handleCheckSiteNow}
            />
          )}

          {currentTab === 'alerts' && (
            <AlertsView
              alertRules={alertRules}
              falseAlarmConfig={falseAlarmConfig}
              onUpdateRule={(updated) =>
                setAlertRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
              }
              onUpdateFalseAlarmConfig={(cfg) => {
                setFalseAlarmConfig(cfg);
                addToast('success', 'Configurações salvas', 'Parâmetros anti-falsos alertas atualizados.');
              }}
              onSendTestAlert={handleSendTestAlert}
            />
          )}

          {currentTab === 'reports' && (
            <ReportsView
              sites={sites}
              incidents={incidents}
              onSelectSite={handleSelectSite}
            />
          )}

          {currentTab === 'settings' && (
            <SettingsView
              onSimulateOutage={handleSimulateOutage}
              onSimulateSlowdown={handleSimulateSlowdown}
              onRestoreAllHealthy={handleRestoreAllHealthy}
              onResetToDefaults={handleResetToDefaults}
            />
          )}
        </main>
      </div>

      {/* Modals & Dialogs */}
      <AddEditSiteModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={handleSaveSite}
        siteToEdit={siteToEdit}
      />

      <IncidentDetailModal
        isOpen={isIncidentModalOpen}
        incident={selectedIncidentDetail}
        onClose={() => {
          setIsIncidentModalOpen(false);
          setSelectedIncidentDetail(null);
        }}
        onResolve={handleResolveIncident}
        onRecheckSite={handleCheckSiteNow}
      />

      {/* Micro-interaction Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
