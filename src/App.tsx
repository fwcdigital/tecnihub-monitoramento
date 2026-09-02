import React, { useState, useEffect, useCallback } from 'react';
import { 
  Site, 
  Incident, 
  NavigationTab,
  TechnicalCredentialPayload
} from './types';
import { 
  getSitesFromDatabase, 
  getIncidentsFromDatabase,
  createSiteInDatabase, 
  updateSiteInDatabase, 
  deleteSiteFromDatabase, 
  togglePauseSiteInDatabase, 
  checkSiteNow, 
  checkAllSitesNow,
  resolveIncidentInDatabase,
  mapDbIncidentToIncident
} from './services/siteService';
import { AdminUser, getAdminSession, loginAdmin, logoutAdmin } from './services/authService';
import { createTechnicalCredential } from './services/credentialService';

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
import { LoginView } from './components/LoginView';
import { PublicStatusPage } from './components/PublicStatusPage';
import { diagnosticTypeLabel } from './utils/diagnosticLabels';

function AdminApp() {
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>('checking');
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Navigation State
  const [currentTab, setCurrentTab] = useState<NavigationTab>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Core Data State
  const [sites, setSites] = useState<Site[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [operationalDataStatus, setOperationalDataStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [operationalDataError, setOperationalDataError] = useState('');

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
    const id = `toast-${crypto.randomUUID()}`;
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const reloadOperationalData = useCallback(async () => {
    const dbSites = await getSitesFromDatabase();
    const dbIncidents = await getIncidentsFromDatabase(dbSites);
    setSites(dbSites);
    setIncidents(dbIncidents);
  }, []);

  useEffect(() => {
    let active = true;
    getAdminSession()
      .then((user) => {
        if (!active) return;
        setAdminUser(user);
        setAuthStatus(user ? 'authenticated' : 'unauthenticated');
      })
      .catch(() => {
        if (!active) return;
        setAdminUser(null);
        setAuthStatus('unauthenticated');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleSessionExpired = () => {
      setAdminUser(null);
      setSites([]);
      setIncidents([]);
      setOperationalDataStatus('loading');
      setOperationalDataError('');
      setAuthStatus('unauthenticated');
    };
    window.addEventListener('tecnihub:session-expired', handleSessionExpired);
    return () => window.removeEventListener('tecnihub:session-expired', handleSessionExpired);
  }, []);

  // 1. Initial Load: all database access now goes through the backend API.
  useEffect(() => {
    if (authStatus !== 'authenticated') return;

    async function loadData() {
      setOperationalDataStatus('loading');
      setOperationalDataError('');
      try {
        await reloadOperationalData();
        setOperationalDataStatus('ready');
      } catch (err: any) {
        console.error('Erro ao carregar sites pela API:', err);
        setSites([]);
        setIncidents([]);
        setOperationalDataStatus('error');
        setOperationalDataError(err.message || 'Não foi possível carregar os dados operacionais.');
        addToast('error', 'Falha ao carregar sites', err.message);
      }
    }

    loadData();
  }, [addToast, authStatus, reloadOperationalData]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    const timer = window.setInterval(() => {
      reloadOperationalData().catch((error) => {
        console.error('Falha no auto-refresh dos dados operacionais:', error);
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [authStatus, reloadOperationalData]);

  const handleRetryOperationalData = async () => {
    setOperationalDataStatus('loading');
    setOperationalDataError('');
    try {
      await reloadOperationalData();
      setOperationalDataStatus('ready');
    } catch (err: any) {
      setOperationalDataStatus('error');
      setOperationalDataError(err.message || 'Não foi possível carregar os dados operacionais.');
    }
  };

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
  const offlineCount = sites.filter((s) => s.status === 'offline' || s.status === 'critical').length;
  const warningCount = sites.filter((s) => s.status === 'warning' || s.status === 'security_blocked').length;
  const onlineCount = sites.filter((s) => s.status === 'online').length;
  const pausedCount = sites.filter((s) => s.status === 'paused').length;
  const unknownCount = sites.filter((s) => s.status === 'unknown').length;
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
  const handleSaveSite = async (siteData: Partial<Site>, technicalAccesses: TechnicalCredentialPayload[] = []) => {
    setIsSavingSite(true);
    try {
      if (siteToEdit) {
        // Edit existing site through the backend (never directly through anon RLS).
        await updateSiteInDatabase(siteToEdit.id, siteData);
        try {
          await reloadOperationalData();
        } catch {
          setSites((prev) => prev.map((s) => (s.id === siteToEdit.id ? { ...s, ...siteData } : s)));
        }
        addToast('success', 'Site atualizado', `As configurações de ${siteData.siteName || siteToEdit.siteName} foram salvas.`);
      } else {
        // Add new site
        const createdSite = await createSiteInDatabase(siteData);
        if (createdSite) {
          setSites((prev) => [createdSite, ...prev]);
          addToast('success', 'Site cadastrado com sucesso', `${createdSite.siteName} foi salvo no banco.`);
          if (technicalAccesses.length > 0) {
            let createdAccesses = 0;
            for (const access of technicalAccesses) {
              try {
                await createTechnicalCredential(createdSite.id, access);
                createdAccesses++;
              } catch {
                // The site remains valid. Failed optional accesses can be added
                // later from the site detail without resubmitting the site.
              }
            }
            if (createdAccesses === technicalAccesses.length) {
              addToast('success', 'Acessos técnicos cadastrados', `${createdAccesses} acesso(s) foram vinculados ao site e protegidos pelo cofre.`);
            } else {
              addToast(
                'warning',
                'Site salvo; alguns acessos ficaram pendentes',
                `${createdAccesses} de ${technicalAccesses.length} acesso(s) foram cadastrados. Complete os demais em Detalhes do Site.`
              );
            }
          }
        }
      }
      return true;
    } catch (err: any) {
      console.error('Erro ao salvar site:', err);
      addToast('error', 'Erro ao salvar site', err.message || 'Ocorreu um erro ao salvar o site.');
      return false;
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

    try {
      await togglePauseSiteInDatabase(siteId, !isCurrentlyPaused);
      try {
        await reloadOperationalData();
      } catch (reloadError) {
        console.error('Alteração persistida, mas a atualização da tela falhou:', reloadError);
        setSites((previous) => previous.map((candidate) => candidate.id === siteId
          ? {
              ...candidate,
              isActive: isCurrentlyPaused,
              status: isCurrentlyPaused ? 'unknown' : 'paused'
            }
          : candidate));
      }

      addToast(
        nextStatus === 'paused' ? 'info' : 'success',
        nextStatus === 'paused' ? 'Monitoramento desativado' : 'Monitoramento reativado',
        `O monitoramento de ${site.domain} foi ${nextStatus === 'paused' ? 'desativado' : 'reativado'}.`
      );
    } catch (err: any) {
      console.error('Erro ao alterar monitoramento do site:', err);
      addToast('error', 'Erro ao alternar status', err.message);
    }
  };

  // Confirm Delete Site
  const handleConfirmDeleteSite = async (siteId: string, confirmation: string) => {
    const site = sites.find((s) => s.id === siteId);
    if (!site) return;

    setIsDeletingSite(true);
    try {
      await deleteSiteFromDatabase(siteId, confirmation);

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
      const response = await checkSiteNow(siteId);
      const { result } = response;
      const diagnosticLabel = diagnosticTypeLabel(result.errorType, result.status, result.httpStatus);
      try {
        await reloadOperationalData();
      } catch (reloadError) {
        console.error('Check persistido, mas a atualização da tela falhou:', reloadError);
      }

      if (result.status === 'online') {
        addToast(
          'success',
          'Verificação concluída com sucesso',
          `${targetSite.domain} respondeu em ${result.responseTime}ms (HTTP ${result.httpStatus ?? 'sem código'}).`
        );
      } else if (result.status === 'warning') {
        addToast(
          'warning',
          'Alerta na verificação',
          `${targetSite.domain}: ${diagnosticLabel}.`
        );
      } else if (result.status === 'security_blocked') {
        addToast('warning', 'Verificação bloqueada por segurança', `${targetSite.domain}: ${result.resultMessage}`);
      } else if (result.status === 'critical') {
        addToast(
          'error',
          'Falha crítica na verificação',
          `${targetSite.domain}: ${diagnosticLabel}.`
        );
      } else {
        addToast(
          'error',
          'Serviço indisponível',
          `${targetSite.domain}: ${diagnosticLabel}.`
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
      const response = await checkAllSitesNow();
      try {
        await reloadOperationalData();
      } catch (reloadError) {
        console.error('Varredura persistida, mas a atualização da tela falhou:', reloadError);
      }
      addToast(
        response.totalFailed > 0 ? 'warning' : 'success',
        'Varredura global finalizada',
        `${response.totalChecked || 0} sites verificados; ${response.totalFailed || 0} falha(s) isolada(s).`
      );
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

  // Select incident for modal
  const handleSelectIncident = (incident: Incident) => {
    setSelectedIncidentDetail(incident);
    setIsIncidentModalOpen(true);
  };

  const handleResolveIncident = async (incidentId: string) => {
    const inc = incidents.find((i) => i.id === incidentId);
    if (!inc) return;
    try {
      const resolvedIncident = await resolveIncidentInDatabase(incidentId);
      try {
        await reloadOperationalData();
      } catch (reloadError) {
        console.error('Resolução persistida, mas a atualização da tela falhou:', reloadError);
        setIncidents((previous) => previous.map((incident) => incident.id === incidentId
          ? mapDbIncidentToIncident(resolvedIncident, sites)
          : incident));
      }
      addToast('success', 'Incidente marcado como resolvido', `Ocorrência de ${inc.client} foi encerrada.`);
    } catch (err: any) {
      addToast('error', 'Falha ao resolver incidente', err.message);
    }
  };

  const handleLogin = async (email: string, password: string) => {
    const user = await loginAdmin(email, password);
    setOperationalDataStatus('loading');
    setOperationalDataError('');
    setAdminUser(user);
    setAuthStatus('authenticated');
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logoutAdmin();
    } finally {
      setSites([]);
      setIncidents([]);
      setAdminUser(null);
      setOperationalDataStatus('loading');
      setOperationalDataError('');
      setAuthStatus('unauthenticated');
      setIsLoggingOut(false);
    }
  };

  if (authStatus === 'checking') {
    return (
      <div className="min-h-screen bg-black text-neutral-500 flex items-center justify-center font-mono text-xs">
        Validando sessão administrativa...
      </div>
    );
  }

  if (!adminUser || authStatus !== 'authenticated') {
    return <LoginView onLogin={handleLogin} />;
  }

  if (operationalDataStatus !== 'ready') {
    return (
      <div className="min-h-screen bg-black text-neutral-400 flex items-center justify-center p-6 font-mono text-xs">
        {operationalDataStatus === 'loading' ? (
          <span>Carregando dados operacionais persistidos...</span>
        ) : (
          <div className="max-w-md text-center space-y-3">
            <p className="text-white font-semibold">Não foi possível carregar os dados operacionais.</p>
            <p className="text-neutral-500">{operationalDataError || 'Serviço indisponível.'}</p>
            <button onClick={handleRetryOperationalData} className="px-3 py-1.5 rounded bg-white text-black font-semibold">
              Tentar novamente
            </button>
          </div>
        )}
      </div>
    );
  }

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
        onlineCount={onlineCount}
        pausedCount={pausedCount}
        unknownCount={unknownCount}
        totalSitesCount={sites.length}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        adminEmail={adminUser.email}
        onLogout={handleLogout}
        isLoggingOut={isLoggingOut}
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
              isChecking={checkingSiteId === selectedSiteDetail.id}
              notify={addToast}
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
            <AlertsView />
          )}

          {currentTab === 'reports' && (
            <ReportsView
              sites={sites}
              incidents={incidents}
              onSelectSite={handleSelectSite}
            />
          )}

          {currentTab === 'settings' && (
            <SettingsView />
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

export default function App() {
  return window.location.pathname.startsWith('/admin') ? <AdminApp /> : <PublicStatusPage />;
}
