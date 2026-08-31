import React, { useState, useEffect, useCallback } from 'react';
import { 
  Site, 
  Incident, 
  AlertRule, 
  FalseAlarmConfig, 
  NavigationTab,
  CheckRecord
} from './types';
import { 
  INITIAL_SITES, 
  INITIAL_INCIDENTS, 
  INITIAL_ALERT_RULES, 
  INITIAL_FALSE_ALARM_CONFIG 
} from './data/mockData';
import { analyzeSiteTracking } from './utils/trackingAnalyzer';
import { isSupabaseConfigured } from './services/supabaseClient';
import { 
  getSitesFromDatabase, 
  createSiteInDatabase, 
  updateSiteInDatabase, 
  deleteSiteFromDatabase, 
  togglePauseSiteInDatabase, 
  checkSiteNow, 
  checkAllSitesNow 
} from './services/siteService';

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
import { ConfirmDeleteModal } from './components/ConfirmDeleteModal';
import { ToastContainer, ToastMessage } from './components/Toast';

export default function App() {
  // Navigation State
  const [currentTab, setCurrentTab] = useState<NavigationTab>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Core Data State
  const [sites, setSites] = useState<Site[]>([]);
  const [isLoadingSites, setIsLoadingSites] = useState(true);

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
  const [isSavingSite, setIsSavingSite] = useState(false);
  const [siteToEdit, setSiteToEdit] = useState<Site | null>(null);
  const [siteToDelete, setSiteToDelete] = useState<Site | null>(null);
  const [isDeletingSite, setIsDeletingSite] = useState(false);
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

  // 1. Initial Load: Fetch from Supabase or Fallback
  useEffect(() => {
    async function loadData() {
      setIsLoadingSites(true);
      if (isSupabaseConfigured()) {
        try {
          const dbSites = await getSitesFromDatabase();
          setSites(dbSites);
        } catch (err: any) {
          console.error('Erro ao carregar do Supabase:', err);
          addToast('error', 'Falha ao conectar com o Supabase', err.message);
        }
      } else {
        // Fallback para localStorage se Supabase ainda não estiver configurado
        try {
          const saved = localStorage.getItem('tecnihub_sites_v1');
          if (saved) {
            setSites(JSON.parse(saved));
          } else {
            setSites([]);
          }
        } catch {
          setSites([]);
        }
      }
      setIsLoadingSites(false);
    }

    loadData();
  }, [addToast]);

  // Save to localStorage as backup if Supabase is not yet configured
  useEffect(() => {
    if (!isSupabaseConfigured() && !isLoadingSites) {
      try {
        localStorage.setItem('tecnihub_sites_v1', JSON.stringify(sites));
      } catch {}
    }
  }, [sites, isLoadingSites]);

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

  // Modal Triggers
  const handleOpenAddSite = () => {
    setSiteToEdit(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEditSite = (site: Site) => {
    setSiteToEdit(site);
    setIsAddModalOpen(true);
  };

  const handleOpenDeleteSite = (siteId: string) => {
    const site = sites.find((s) => s.id === siteId);
    if (site) {
      setSiteToDelete(site);
    }
  };

  // Save Site (Create or Update)
  const handleSaveSite = async (siteData: Partial<Site>) => {
    setIsSavingSite(true);
    try {
      if (siteToEdit) {
        // Edit existing site
        if (isSupabaseConfigured()) {
          await updateSiteInDatabase(siteToEdit.id, siteData);
        }
        setSites((prev) =>
          prev.map((s) => (s.id === siteToEdit.id ? { ...s, ...siteData } : s))
        );
        addToast('success', 'Site atualizado', `As configurações de ${siteData.siteName || siteToEdit.siteName} foram salvas.`);
        setIsAddModalOpen(false);
      } else {
        // Add new site
        if (isSupabaseConfigured()) {
          const createdSite = await createSiteInDatabase(siteData);
          if (createdSite) {
            setSites((prev) => [createdSite, ...prev]);
            addToast('success', 'Site cadastrado com sucesso', `${createdSite.siteName} foi salvo no banco e verificado.`);
          }
        } else {
          // Local fallback
          const newId = `site-${Date.now()}`;
          const newSite: Site = {
            id: newId,
            client: siteData.client || 'Novo Cliente',
            siteName: siteData.siteName || 'Novo Site',
            url: siteData.url || 'https://exemplo.com.br',
            domain: siteData.domain || 'exemplo.com.br',
            hosting: siteData.hosting || 'Hostinger',
            isWordPress: siteData.isWordPress ?? false,
            isActive: true,
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
          addToast('success', 'Site cadastrado com sucesso', `${newSite.siteName} entrou na fila de monitoramento.`);
        }
        setIsAddModalOpen(false);
      }
    } catch (err: any) {
      console.error('Erro ao salvar site:', err);
      addToast('error', 'Erro ao salvar site', err.message || 'Ocorreu um erro ao salvar o site.');
    } finally {
      setIsSavingSite(false);
    }
  };

  // Toggle Pause/Resume
  const handleTogglePauseSite = async (siteId: string) => {
    const site = sites.find((s) => s.id === siteId);
    if (!site) return;

    const isCurrentlyPaused = site.status === 'paused';
    const nextStatus = isCurrentlyPaused ? 'online' : 'paused';
    const nextIsActive = isCurrentlyPaused; // if paused, next is active (true)

    try {
      if (isSupabaseConfigured()) {
        await togglePauseSiteInDatabase(siteId, !isCurrentlyPaused);
      }

      setSites((prev) =>
        prev.map((s) => {
          if (s.id === siteId) {
            return {
              ...s,
              status: nextStatus,
              isActive: nextIsActive,
              lastCheck: nextStatus === 'paused' ? 'Pausado' : 'Há 1 min'
            };
          }
          return s;
        })
      );

      addToast(
        nextStatus === 'paused' ? 'info' : 'success',
        nextStatus === 'paused' ? 'Monitoramento pausado' : 'Monitoramento retomado',
        `O site ${site.domain} foi ${nextStatus === 'paused' ? 'pausado' : 'reativado'}.`
      );
    } catch (err: any) {
      console.error('Erro ao pausar site:', err);
      addToast('error', 'Erro ao alternar status', err.message);
    }
  };

  // Confirm Delete Site
  const handleConfirmDeleteSite = async (siteId: string) => {
    const site = sites.find((s) => s.id === siteId);
    if (!site) return;

    setIsDeletingSite(true);
    try {
      if (isSupabaseConfigured()) {
        await deleteSiteFromDatabase(siteId);
      }

      setSites((prev) => prev.filter((s) => s.id !== siteId));

      if (selectedSiteDetail?.id === siteId) {
        setSelectedSiteDetail(null);
        setCurrentTab('dashboard');
      }

      setSiteToDelete(null);
      addToast('info', 'Site removido', `${site.siteName} foi excluído da monitoria.`);
    } catch (err: any) {
      console.error('Erro ao excluir site:', err);
      addToast('error', 'Erro ao excluir site', err.message);
    } finally {
      setIsDeletingSite(false);
    }
  };

  // Perform Real Single HTTP Check via Backend
  const handleCheckSiteNow = async (siteId: string) => {
    const targetSite = sites.find((s) => s.id === siteId);
    if (!targetSite) return;

    setCheckingSiteId(siteId);

    try {
      const response = await checkSiteNow(siteId, targetSite.url);
      const { result, checkedAt } = response;

      const dateObj = new Date(checkedAt || Date.now());
      const day = String(dateObj.getDate()).padStart(2, '0');
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const hours = String(dateObj.getHours()).padStart(2, '0');
      const mins = String(dateObj.getMinutes()).padStart(2, '0');
      const secs = String(dateObj.getSeconds()).padStart(2, '0');
      const formattedTimestamp = `${day}/${month} ${hours}:${mins}:${secs}`;

      const responseTimeInSeconds = +(result.responseTime / 1000).toFixed(2);

      const newRecord: CheckRecord = {
        id: response.checkId || `chk-${Date.now()}`,
        timestamp: formattedTimestamp,
        status: result.status,
        httpCode: result.httpStatus ?? (result.status === 'offline' ? 'ERR' : 200),
        responseTime: responseTimeInSeconds,
        result: result.resultMessage
      };

      setSites((prev) =>
        prev.map((s) => {
          if (s.id === siteId) {
            const updatedHistory = [newRecord, ...s.checksHistory.slice(0, 19)];
            const onlineChecks = updatedHistory.filter(c => c.status === 'online').length;
            const newUptime = +((onlineChecks / updatedHistory.length) * 100).toFixed(2);

            return {
              ...s,
              status: result.status,
              httpStatus: result.httpStatus ?? (result.status === 'offline' ? 503 : 200),
              responseTime: result.status === 'offline' ? 0 : responseTimeInSeconds,
              lastCheck: 'Há instantes',
              uptime30d: newUptime,
              consecutiveFailures: result.status === 'offline' ? (s.consecutiveFailures + 1) : 0,
              checksHistory: updatedHistory
            };
          }
          return s;
        })
      );

      if (result.status === 'online') {
        addToast(
          'success',
          'Verificação concluída com sucesso',
          `${targetSite.domain} respondeu em ${result.responseTime}ms (HTTP ${result.httpStatus || 200}).`
        );
      } else if (result.status === 'warning') {
        addToast(
          'warning',
          'Alerta na verificação',
          `${targetSite.domain} retornou HTTP ${result.httpStatus}. ${result.errorMessage || ''}`
        );
      } else {
        addToast(
          'error',
          'CRÍTICO: Falha na verificação',
          `${targetSite.domain}: ${result.resultMessage}`
        );
      }

    } catch (err: any) {
      console.error('Erro na verificação HTTP:', err);
      addToast('error', 'Falha na verificação do site', err.message || 'Não foi possível conectar ao backend de verificação.');
    } finally {
      setCheckingSiteId(null);
    }
  };

  // Check all sites ping
  const handleCheckAllSites = async () => {
    if (sites.length === 0) {
      addToast('info', 'Nenhum site cadastrado', 'Adicione sites antes de executar a varredura.');
      return;
    }

    setIsCheckingAll(true);
    try {
      const activeSites = sites
        .filter((s) => s.status !== 'paused')
        .map((s) => ({ id: s.id, url: s.url, name: s.siteName }));

      const response = await checkAllSitesNow(activeSites);

      if (response && response.results) {
        setSites((prev) =>
          prev.map((s) => {
            const checkData = response.results.find((r: any) => r.siteId === s.id);
            if (!checkData) return s;

            const res = checkData.result;
            const resTimeSec = +(res.responseTime / 1000).toFixed(2);
            const now = new Date();
            const day = String(now.getDate()).padStart(2, '0');
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const hours = String(now.getHours()).padStart(2, '0');
            const mins = String(now.getMinutes()).padStart(2, '0');
            const secs = String(now.getSeconds()).padStart(2, '0');

            const record: CheckRecord = {
              id: `chk-${Date.now()}-${s.id}`,
              timestamp: `${day}/${month} ${hours}:${mins}:${secs}`,
              status: res.status,
              httpCode: res.httpStatus ?? (res.status === 'offline' ? 'ERR' : 200),
              responseTime: resTimeSec,
              result: res.resultMessage
            };

            const updatedHistory = [record, ...s.checksHistory.slice(0, 19)];
            const onlineChecks = updatedHistory.filter(c => c.status === 'online').length;
            const newUptime = +((onlineChecks / updatedHistory.length) * 100).toFixed(2);

            return {
              ...s,
              status: res.status,
              httpStatus: res.httpStatus ?? (res.status === 'offline' ? 503 : 200),
              responseTime: res.status === 'offline' ? 0 : resTimeSec,
              lastCheck: 'Há instantes',
              uptime30d: newUptime,
              consecutiveFailures: res.status === 'offline' ? (s.consecutiveFailures + 1) : 0,
              checksHistory: updatedHistory
            };
          })
        );

        addToast('success', 'Varredura global finalizada', `${response.totalChecked || activeSites.length} sites verificados pelo servidor com sucesso.`);
      }
    } catch (err: any) {
      console.error('Erro na varredura global:', err);
      addToast('error', 'Falha na varredura global', err.message);
    } finally {
      setIsCheckingAll(false);
    }
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

  // Simulator Triggers (for testing)
  const handleSimulateOutage = () => {
    if (sites.length === 0) {
      addToast('info', 'Cadastre um site primeiro para testar o simulador.', '');
      return;
    }
    const target = sites[0];
    setSites((prev) =>
      prev.map((s) => {
        if (s.id === target.id) {
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
    addToast('error', 'Simulação de Queda Ativada', `${target.client} marcado como Offline (HTTP 503).`);
    setCurrentTab('dashboard');
  };

  const handleSimulateSlowdown = () => {
    if (sites.length === 0) {
      addToast('info', 'Cadastre um site primeiro para testar o simulador.', '');
      return;
    }
    const target = sites[0];
    setSites((prev) =>
      prev.map((s) => {
        if (s.id === target.id) {
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
    addToast('warning', 'Simulação de Lentidão Ativada', `${target.siteName} com tempo de resposta em 5,74s.`);
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
              onDeleteSite={handleOpenDeleteSite}
              onCheckSiteNow={handleCheckSiteNow}
              onSelectIncident={handleSelectIncident}
              isCheckingAll={isCheckingAll}
              onCheckAllSites={handleCheckAllSites}
              checkingSiteId={checkingSiteId}
            />
          )}

          {currentTab === 'sites' && (
            <SitesView
              sites={sites}
              onAddSite={handleOpenAddSite}
              onSelectSite={handleSelectSite}
              onEditSite={handleOpenEditSite}
              onTogglePause={handleTogglePauseSite}
              onDeleteSite={handleOpenDeleteSite}
              onCheckSiteNow={handleCheckSiteNow}
              checkingSiteId={checkingSiteId}
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
        isSaving={isSavingSite}
      />

      <ConfirmDeleteModal
        isOpen={Boolean(siteToDelete)}
        site={siteToDelete}
        onClose={() => setSiteToDelete(null)}
        onConfirm={handleConfirmDeleteSite}
        isDeleting={isDeletingSite}
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
