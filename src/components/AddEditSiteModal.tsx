import React, { useState, useEffect } from 'react';
import { X, Globe, Server, Clock, Shield, Search, Check, AlertCircle, Tag, Radio, Edit3, KeyRound, Plus, Trash2 } from 'lucide-react';
import { Site, HostingProvider, MonitoringFrequency, SiteTrackingConfig, TechnicalCredentialPayload } from '../types';
import {
  EMPTY_TECHNICAL_ACCESS,
  TECHNICAL_ACCESS_TYPE_LABELS,
  TechnicalAccessFields,
  technicalAccessTitle,
  validateTechnicalAccess
} from './TechnicalAccessFields';

interface AddEditSiteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (siteData: Partial<Site>, accesses?: TechnicalCredentialPayload[]) => Promise<boolean> | boolean;
  siteToEdit?: Site | null;
  isSaving?: boolean;
}

export const AddEditSiteModal: React.FC<AddEditSiteModalProps> = ({
  isOpen,
  onClose,
  onSave,
  siteToEdit,
  isSaving = false
}) => {
  const [client, setClient] = useState('');
  const [siteName, setSiteName] = useState('');
  const [url, setUrl] = useState('https://');
  const [domain, setDomain] = useState('');
  const [hosting, setHosting] = useState<HostingProvider>('Hostinger');
  const [frequency, setFrequency] = useState<MonitoringFrequency>('5min');
  const [slaTargetPercent, setSlaTargetPercent] = useState(99.9);
  const [isWordPress, setIsWordPress] = useState(false);
  
  // Toggles
  const [monitorAvailability, setMonitorAvailability] = useState(true);
  const [monitorResponseTime, setMonitorResponseTime] = useState(true);
  const [monitorSsl, setMonitorSsl] = useState(true);
  const [monitorDomain, setMonitorDomain] = useState(true);
  const [monitorRedirects, setMonitorRedirects] = useState(true);
  const [monitorContent, setMonitorContent] = useState(false);
  const [expectedContentText, setExpectedContentText] = useState('');

  // Rastreamento (Tracking) Form State
  const [ga4Enabled, setGa4Enabled] = useState(false);
  const [ga4ExpectedId, setGa4ExpectedId] = useState('');
  
  const [gtmEnabled, setGtmEnabled] = useState(false);
  const [gtmExpectedId, setGtmExpectedId] = useState('');
  
  const [googleAdsEnabled, setGoogleAdsEnabled] = useState(false);
  const [googleAdsExpectedId, setGoogleAdsExpectedId] = useState('');
  
  const [metaPixelEnabled, setMetaPixelEnabled] = useState(false);
  const [metaPixelExpectedId, setMetaPixelExpectedId] = useState('');
  
  const [rdStationEnabled, setRdStationEnabled] = useState(false);
  const [rdStationExpectedId, setRdStationExpectedId] = useState('');

  const [searchConsoleEnabled, setSearchConsoleEnabled] = useState(false);
  const [searchConsoleConfigured, setSearchConsoleConfigured] = useState(false);

  const [technicalAccesses, setTechnicalAccesses] = useState<TechnicalCredentialPayload[]>([]);
  const [accessDraft, setAccessDraft] = useState<TechnicalCredentialPayload>({ ...EMPTY_TECHNICAL_ACCESS });
  const [editingAccessIndex, setEditingAccessIndex] = useState<number | null>(null);
  const [showAccessEditor, setShowAccessEditor] = useState(false);
  const [accessError, setAccessError] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (siteToEdit) {
      setClient(siteToEdit.client);
      setSiteName(siteToEdit.siteName);
      setUrl(siteToEdit.url);
      setDomain(siteToEdit.domain);
      setHosting(siteToEdit.hosting);
      setIsWordPress(Boolean(siteToEdit.isWordPress));
      setFrequency(siteToEdit.frequency);
      setSlaTargetPercent(siteToEdit.slaTargetPercent ?? 99.9);
      setMonitorAvailability(siteToEdit.monitorAvailability);
      setMonitorResponseTime(siteToEdit.monitorResponseTime);
      setMonitorSsl(siteToEdit.monitorSsl);
      setMonitorDomain(siteToEdit.monitorDomain);
      setMonitorRedirects(siteToEdit.monitorRedirects);
      setMonitorContent(siteToEdit.monitorContent);
      setExpectedContentText(siteToEdit.expectedContentText || '');

      // Load tracking configuration
      if (siteToEdit.tracking) {
        setGa4Enabled(siteToEdit.tracking.ga4?.enabled ?? true);
        setGa4ExpectedId(siteToEdit.tracking.ga4?.expectedId || '');
        
        setGtmEnabled(siteToEdit.tracking.gtm?.enabled ?? true);
        setGtmExpectedId(siteToEdit.tracking.gtm?.expectedId || '');
        
        setGoogleAdsEnabled(siteToEdit.tracking.googleAds?.enabled ?? false);
        setGoogleAdsExpectedId(siteToEdit.tracking.googleAds?.expectedId || '');
        
        setMetaPixelEnabled(siteToEdit.tracking.metaPixel?.enabled ?? false);
        setMetaPixelExpectedId(siteToEdit.tracking.metaPixel?.expectedId || '');
        
        setRdStationEnabled(siteToEdit.tracking.rdStation?.enabled ?? false);
        setRdStationExpectedId(siteToEdit.tracking.rdStation?.expectedId || '');

        setSearchConsoleEnabled(siteToEdit.tracking.searchConsole?.enabled ?? false);
        setSearchConsoleConfigured(siteToEdit.tracking.searchConsole?.searchConsoleConfigured ?? false);
      }
    } else {
      setClient('');
      setSiteName('');
      setUrl('https://');
      setDomain('');
      setHosting('Hostinger');
      setIsWordPress(false);
      setFrequency('5min');
      setSlaTargetPercent(99.9);
      setMonitorAvailability(true);
      setMonitorResponseTime(true);
      setMonitorSsl(true);
      setMonitorDomain(true);
      setMonitorRedirects(true);
      setMonitorContent(false);
      setExpectedContentText('');

      // Defaults for new site
      setGa4Enabled(false);
      setGa4ExpectedId('');
      setGtmEnabled(false);
      setGtmExpectedId('');
      setGoogleAdsEnabled(false);
      setGoogleAdsExpectedId('');
      setMetaPixelEnabled(false);
      setMetaPixelExpectedId('');
      setRdStationEnabled(false);
      setRdStationExpectedId('');
      setSearchConsoleEnabled(false);
      setSearchConsoleConfigured(false);
    }
    setTechnicalAccesses([]);
    setAccessDraft({ ...EMPTY_TECHNICAL_ACCESS });
    setEditingAccessIndex(null);
    setShowAccessEditor(false);
    setAccessError('');
    setErrors({});
  }, [siteToEdit, isOpen]);

  const accessDraftHasContent = (draft: TechnicalCredentialPayload) => Boolean(
    draft.serviceName || draft.provider || draft.url || draft.username || draft.host || draft.port || draft.notes || draft.password
  );

  const resetAccessDraft = () => {
    setAccessDraft({ ...EMPTY_TECHNICAL_ACCESS });
    setEditingAccessIndex(null);
    setShowAccessEditor(false);
    setAccessError('');
  };

  const saveAccessDraft = () => {
    const validationError = validateTechnicalAccess(accessDraft, true);
    if (validationError) { setAccessError(validationError); return; }
    setTechnicalAccesses((current) => editingAccessIndex === null
      ? [...current, { ...accessDraft }]
      : current.map((item, index) => index === editingAccessIndex ? { ...accessDraft } : item));
    resetAccessDraft();
  };

  // Auto-fill domain from URL if empty
  const handleUrlChange = (value: string) => {
    setUrl(value);
    try {
      if (value.startsWith('http')) {
        const parsed = new URL(value);
        if (!domain || domain === '') {
          setDomain(parsed.hostname.replace(/^www\./, ''));
        }
      }
    } catch {
      // url might be partially typed
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!client.trim()) newErrors.client = 'Nome do cliente é obrigatório';
    if (!siteName.trim()) newErrors.siteName = 'Nome do site é obrigatório';
    if (!url.trim() || url === 'https://') newErrors.url = 'URL válida é obrigatória';
    if (!domain.trim()) newErrors.domain = 'Domínio é obrigatório';
    if (monitorContent && !expectedContentText.trim()) {
      newErrors.expectedContentText = 'Informe o texto que deve constar na página';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    let accessesToCreate = technicalAccesses;
    if (!siteToEdit && showAccessEditor && accessDraftHasContent(accessDraft)) {
      const validationError = validateTechnicalAccess(accessDraft, true);
      if (validationError) {
        setAccessError(validationError);
        return;
      }
      accessesToCreate = editingAccessIndex === null
        ? [...technicalAccesses, { ...accessDraft }]
        : technicalAccesses.map((item, index) => index === editingAccessIndex ? { ...accessDraft } : item);
    }

    // Build tracking config
    const trackingConfig: SiteTrackingConfig = {
      ga4: { enabled: ga4Enabled, expectedId: ga4Enabled ? ga4ExpectedId.trim() : '' },
      gtm: { enabled: gtmEnabled, expectedId: gtmEnabled ? gtmExpectedId.trim() : '' },
      googleAds: { enabled: googleAdsEnabled, expectedId: googleAdsEnabled ? googleAdsExpectedId.trim() : '' },
      metaPixel: { enabled: metaPixelEnabled, expectedId: metaPixelEnabled ? metaPixelExpectedId.trim() : '' },
      rdStation: { enabled: rdStationEnabled, expectedId: rdStationEnabled ? rdStationExpectedId.trim() : '' },
      searchConsole: { enabled: searchConsoleEnabled, searchConsoleConfigured },
      lastCheckedAt: undefined,
      lastCheckTimestamp: undefined,
      results: undefined
    };

    const saved = await onSave({
      client: client.trim(),
      siteName: siteName.trim(),
      url: url.trim(),
      domain: domain.trim(),
      hosting,
      isWordPress,
      frequency,
      slaTargetPercent,
      monitorAvailability,
      monitorResponseTime,
      monitorSsl,
      monitorDomain,
      monitorRedirects,
      monitorContent,
      expectedContentText: monitorContent ? expectedContentText.trim() : '',
      tracking: trackingConfig
    }, siteToEdit ? undefined : accessesToCreate);
    if (saved) onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/85 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-[#0a0a0a] border border-[#1e1e1e] rounded shadow-2xl overflow-hidden my-4">
        
        {/* Modal Header */}
        <div className="px-4 py-3 border-b border-[#1e1e1e] flex items-center justify-between bg-[#000000]">
          <div>
            <h2 className="text-sm font-bold text-white font-sans">
              {siteToEdit ? 'Editar Configurações do Site' : 'Adicionar Novo Site para Monitoramento'}
            </h2>
            <p className="text-[11px] text-neutral-400 mt-0.5">
              Defina os parâmetros de verificação contínua e rastreamento para o cliente.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded hover:bg-[#161616] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4 max-h-[calc(85vh-90px)] overflow-y-auto">
          
          {/* Main Info */}
          <div className="space-y-3">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 font-mono">
              1. Informações Principais
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-neutral-300 mb-1 font-mono">
                  Cliente <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={client}
                  onChange={(e) => setClient(e.target.value)}
                  placeholder="Ex: Clinifert, Torge Sistemas"
                  className={`w-full px-2.5 py-1.5 bg-[#000000] border rounded text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 transition-colors font-sans ${
                    errors.client ? 'border-rose-500' : 'border-[#222222]'
                  }`}
                />
                {errors.client && <p className="text-[10px] text-rose-400 mt-0.5 font-mono">{errors.client}</p>}
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-300 mb-1 font-mono">
                  Nome do site <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="Ex: Portal Institucional, Loja Virtual"
                  className={`w-full px-2.5 py-1.5 bg-[#000000] border rounded text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 transition-colors font-sans ${
                    errors.siteName ? 'border-rose-500' : 'border-[#222222]'
                  }`}
                />
                {errors.siteName && <p className="text-[10px] text-rose-400 mt-0.5 font-mono">{errors.siteName}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-neutral-300 mb-1 font-mono">
                  URL completa <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder="https://exemplo.com.br"
                  className={`w-full px-2.5 py-1.5 bg-[#000000] border rounded text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 transition-colors font-mono ${
                    errors.url ? 'border-rose-500' : 'border-[#222222]'
                  }`}
                />
                {errors.url && <p className="text-[10px] text-rose-400 mt-0.5 font-mono">{errors.url}</p>}
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-300 mb-1 font-mono">
                  Domínio principal <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="exemplo.com.br"
                  className={`w-full px-2.5 py-1.5 bg-[#000000] border rounded text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 transition-colors font-mono ${
                    errors.domain ? 'border-rose-500' : 'border-[#222222]'
                  }`}
                />
                {errors.domain && <p className="text-[10px] text-rose-400 mt-0.5 font-mono">{errors.domain}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-neutral-300 mb-1 font-mono">
                  Hospedagem / Provedor
                </label>
                <select
                  value={hosting}
                  onChange={(e) => setHosting(e.target.value as HostingProvider)}
                  className="w-full px-2.5 py-1.5 bg-[#000000] border border-[#222222] rounded text-xs text-white focus:outline-none focus:border-neutral-500 font-mono"
                >
                  <option value="Hostinger">Hostinger</option>
                  <option value="HostGator">HostGator</option>
                  <option value="Cloudways">Cloudways</option>
                  <option value="VPS">VPS Dedicado</option>
                  <option value="Vercel">Vercel</option>
                  <option value="AWS">AWS</option>
                  <option value="DigitalOcean">DigitalOcean</option>
                  <option value="Outro">Outro Provedor</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-300 mb-1 font-mono">
                  WordPress
                </label>
                <div className="flex items-center gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setIsWordPress(true)}
                    className={`flex-1 py-1 px-2 rounded text-xs font-mono transition-colors border text-center ${
                      isWordPress
                        ? 'bg-blue-950/40 text-blue-300 border-blue-600/50 font-semibold'
                        : 'bg-[#000000] text-neutral-400 border-[#222222] hover:text-white'
                    }`}
                  >
                    Sim
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsWordPress(false)}
                    className={`flex-1 py-1 px-2 rounded text-xs font-mono transition-colors border text-center ${
                      !isWordPress
                        ? 'bg-[#1a1a1a] text-neutral-200 border-[#333333] font-semibold'
                        : 'bg-[#000000] text-neutral-400 border-[#222222] hover:text-white'
                    }`}
                  >
                    Não
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-300 mb-1 font-mono">
                  Frequência de checagem
                </label>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as MonitoringFrequency)}
                  className="w-full px-2.5 py-1.5 bg-[#000000] border border-[#222222] rounded text-xs text-white focus:outline-none focus:border-neutral-500 font-mono"
                >
                  <option value="5min">A cada 5 min (Padrão)</option>
                  <option value="15min">A cada 15 min</option>
                  <option value="30min">A cada 30 min</option>
                  <option value="1hour">A cada 1 hora</option>
                  <option value="daily">Diariamente</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-300 mb-1 font-mono">
                  Meta de SLA
                </label>
                <select
                  value={slaTargetPercent}
                  onChange={(event) => setSlaTargetPercent(Number(event.target.value))}
                  className="w-full px-2.5 py-1.5 bg-[#000000] border border-[#222222] rounded text-xs text-white focus:outline-none focus:border-neutral-500 font-mono"
                >
                  <option value={99}>99%</option>
                  <option value={99.5}>99,5%</option>
                  <option value={99.9}>99,9% (Padrão)</option>
                  <option value={99.95}>99,95%</option>
                  <option value={99.99}>99,99%</option>
                </select>
                <p className="mt-1 text-[9px] text-neutral-500">Usada nos relatórios de disponibilidade por incidente confirmado.</p>
              </div>
            </div>
          </div>

          {/* Monitoring Checks Toggles */}
          <div className="space-y-2.5 pt-3 border-t border-[#1e1e1e]">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 font-mono">
              2. Parâmetros de Monitoramento Ativos
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className="flex items-start gap-2.5 p-2.5 rounded bg-[#000000] border border-[#1e1e1e] cursor-pointer hover:border-[#333333] transition-colors">
                <input
                  type="checkbox"
                  checked={monitorAvailability}
                  disabled
                  className="mt-0.5 rounded bg-[#111111] border-[#333333] text-white focus:ring-0"
                />
                <div>
                  <span className="text-xs font-medium text-neutral-200 block">Monitorar disponibilidade</span>
                  <span className="text-[10px] text-neutral-500">Verificação HTTP disponível</span>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-2.5 rounded bg-[#000000] border border-[#1e1e1e] cursor-pointer hover:border-[#333333] transition-colors">
                <input
                  type="checkbox"
                  checked={monitorResponseTime}
                  disabled
                  className="mt-0.5 rounded bg-[#111111] border-[#333333] text-white focus:ring-0"
                />
                <div>
                  <span className="text-xs font-medium text-neutral-200 block">Monitorar tempo de resposta</span>
                  <span className="text-[10px] text-neutral-500">Tempo real registrado em cada check</span>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-2.5 rounded bg-[#000000] border border-[#1e1e1e] cursor-pointer hover:border-[#333333] transition-colors">
                <input
                  type="checkbox"
                  checked={monitorSsl}
                  disabled
                  className="mt-0.5 rounded bg-[#111111] border-[#333333] text-white focus:ring-0"
                />
                <div>
                  <span className="text-xs font-medium text-neutral-200 block">Monitorar certificado SSL</span>
                  <span className="text-[10px] text-neutral-500">TLS real para URLs HTTPS; HTTP é não aplicável</span>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-2.5 rounded bg-[#000000] border border-[#1e1e1e] cursor-pointer hover:border-[#333333] transition-colors">
                <input
                  type="checkbox"
                  checked={monitorDomain}
                  disabled
                  className="mt-0.5 rounded bg-[#111111] border-[#333333] text-white focus:ring-0"
                />
                <div>
                  <span className="text-xs font-medium text-neutral-200 block">Monitorar domínio (WHOIS)</span>
                  <span className="text-[10px] text-neutral-500">Consulta RDAP real com cache</span>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-2.5 rounded bg-[#000000] border border-[#1e1e1e] cursor-pointer hover:border-[#333333] transition-colors">
                <input
                  type="checkbox"
                  checked={monitorRedirects}
                  disabled
                  className="mt-0.5 rounded bg-[#111111] border-[#333333] text-white focus:ring-0"
                />
                <div>
                  <span className="text-xs font-medium text-neutral-200 block">Monitorar redirecionamentos</span>
                  <span className="text-[10px] text-neutral-500">Redirect final registrado pelo check HTTP</span>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-2.5 rounded bg-[#000000] border border-[#1e1e1e] cursor-pointer hover:border-[#333333] transition-colors">
                <input
                  type="checkbox"
                  checked={monitorContent}
                  onChange={(event) => setMonitorContent(event.target.checked)}
                  className="mt-0.5 rounded bg-[#111111] border-[#333333] text-white focus:ring-0"
                />
                <div>
                  <span className="text-xs font-medium text-neutral-200 block">Verificação de conteúdo</span>
                  <span className="text-[10px] text-neutral-500">Busca literal no HTML real de cada check</span>
                </div>
              </label>
            </div>
          </div>

          {/* Content Verification Keyword Field */}
          {monitorContent && (
            <div className="p-3 rounded bg-[#000000] border border-[#222222] space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-200">
                <Search className="w-3.5 h-3.5 text-neutral-400" />
                <span>Texto Obrigatório no Conteúdo</span>
              </div>
              <p className="text-[10px] text-neutral-400 leading-relaxed">
                Informe um termo ou trecho de texto que deve obrigatoriamente existir na resposta. 
                O check procura este texto no HTML real; ausência com resposta HTTP válida gera warning operacional.
              </p>
              <input
                type="text"
                value={expectedContentText}
                onChange={(e) => setExpectedContentText(e.target.value)}
                placeholder="Ex: Clinifert, Bem-vindo ao Portal"
                className={`w-full px-2.5 py-1.5 bg-[#0a0a0a] border rounded text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 transition-colors font-mono ${
                  errors.expectedContentText ? 'border-rose-500' : 'border-[#333333]'
                }`}
              />
              {errors.expectedContentText && (
                <p className="text-[10px] text-rose-400 font-mono">{errors.expectedContentText}</p>
              )}
            </div>
          )}

          {/* 3. Rastreamento (Tracking) Configuration */}
          <div className="space-y-3 pt-3 border-t border-[#1e1e1e]">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 font-mono flex items-center gap-1.5">
                  <Tag className="w-3 h-3 text-neutral-400" />
                  3. Rastreamento e Tags de Conversão
                </h3>
                <p className="text-[11px] text-neutral-500 mt-0.5">
                  Marque as ferramentas obrigatórias para este cliente e informe os identificadores esperados.
                </p>
              </div>
            </div>

            <div className="space-y-2.5">
              {/* Google Analytics 4 */}
              <div className="p-2.5 rounded bg-[#000000] border border-[#1e1e1e] space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ga4Enabled}
                      onChange={(e) => setGa4Enabled(e.target.checked)}
                      className="rounded bg-[#111111] border-[#333333] text-white focus:ring-0"
                    />
                    <span className="text-xs font-semibold text-neutral-200">Google Analytics 4</span>
                  </label>
                  <span className="text-[10px] font-mono text-neutral-500">Métrica GA4</span>
                </div>
                {ga4Enabled && (
                  <div className="pt-1.5 pl-6 border-t border-[#161616]">
                    <label className="block text-[10px] font-mono text-neutral-400 mb-1">
                      Measurement ID esperado:
                    </label>
                    <input
                      type="text"
                      value={ga4ExpectedId}
                      onChange={(e) => setGa4ExpectedId(e.target.value)}
                      placeholder="G-XXXXXXXXXX"
                      className="w-full px-2 py-1 bg-[#0a0a0a] border border-[#2a2a2a] rounded text-xs text-white placeholder-neutral-700 font-mono focus:outline-none focus:border-neutral-500"
                    />
                  </div>
                )}
              </div>

              {/* Google Tag Manager */}
              <div className="p-2.5 rounded bg-[#000000] border border-[#1e1e1e] space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={gtmEnabled}
                      onChange={(e) => setGtmEnabled(e.target.checked)}
                      className="rounded bg-[#111111] border-[#333333] text-white focus:ring-0"
                    />
                    <span className="text-xs font-semibold text-neutral-200">Google Tag Manager</span>
                  </label>
                  <span className="text-[10px] font-mono text-neutral-500">Contêiner GTM</span>
                </div>
                {gtmEnabled && (
                  <div className="pt-1.5 pl-6 border-t border-[#161616]">
                    <label className="block text-[10px] font-mono text-neutral-400 mb-1">
                      Container ID esperado:
                    </label>
                    <input
                      type="text"
                      value={gtmExpectedId}
                      onChange={(e) => setGtmExpectedId(e.target.value)}
                      placeholder="GTM-XXXXXXX"
                      className="w-full px-2 py-1 bg-[#0a0a0a] border border-[#2a2a2a] rounded text-xs text-white placeholder-neutral-700 font-mono focus:outline-none focus:border-neutral-500"
                    />
                  </div>
                )}
              </div>

              {/* Google Ads */}
              <div className="p-2.5 rounded bg-[#000000] border border-[#1e1e1e] space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={googleAdsEnabled}
                      onChange={(e) => setGoogleAdsEnabled(e.target.checked)}
                      className="rounded bg-[#111111] border-[#333333] text-white focus:ring-0"
                    />
                    <span className="text-xs font-semibold text-neutral-200">Google Ads</span>
                  </label>
                  <span className="text-[10px] font-mono text-neutral-500">Conversão / Remarketing</span>
                </div>
                {googleAdsEnabled && (
                  <div className="pt-1.5 pl-6 border-t border-[#161616]">
                    <label className="block text-[10px] font-mono text-neutral-400 mb-1">
                      ID de Conversão esperado:
                    </label>
                    <input
                      type="text"
                      value={googleAdsExpectedId}
                      onChange={(e) => setGoogleAdsExpectedId(e.target.value)}
                      placeholder="AW-XXXXXXXXX"
                      className="w-full px-2 py-1 bg-[#0a0a0a] border border-[#2a2a2a] rounded text-xs text-white placeholder-neutral-700 font-mono focus:outline-none focus:border-neutral-500"
                    />
                  </div>
                )}
              </div>

              {/* Meta Pixel */}
              <div className="p-2.5 rounded bg-[#000000] border border-[#1e1e1e] space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={metaPixelEnabled}
                      onChange={(e) => setMetaPixelEnabled(e.target.checked)}
                      className="rounded bg-[#111111] border-[#333333] text-white focus:ring-0"
                    />
                    <span className="text-xs font-semibold text-neutral-200">Meta Pixel</span>
                  </label>
                  <span className="text-[10px] font-mono text-neutral-500">Facebook / Instagram Ads</span>
                </div>
                {metaPixelEnabled && (
                  <div className="pt-1.5 pl-6 border-t border-[#161616]">
                    <label className="block text-[10px] font-mono text-neutral-400 mb-1">
                      Pixel ID esperado:
                    </label>
                    <input
                      type="text"
                      value={metaPixelExpectedId}
                      onChange={(e) => setMetaPixelExpectedId(e.target.value)}
                      placeholder="Ex: 123456789012345"
                      className="w-full px-2 py-1 bg-[#0a0a0a] border border-[#2a2a2a] rounded text-xs text-white placeholder-neutral-700 font-mono focus:outline-none focus:border-neutral-500"
                    />
                  </div>
                )}
              </div>

              {/* RD Station */}
              <div className="p-2.5 rounded bg-[#000000] border border-[#1e1e1e] space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rdStationEnabled}
                      onChange={(e) => setRdStationEnabled(e.target.checked)}
                      className="rounded bg-[#111111] border-[#333333] text-white focus:ring-0"
                    />
                    <span className="text-xs font-semibold text-neutral-200">RD Station</span>
                  </label>
                  <span className="text-[10px] font-mono text-neutral-500">Inbound & Leads</span>
                </div>
                {rdStationEnabled && (
                  <div className="pt-1.5 pl-6 border-t border-[#161616] text-[10px] font-mono text-neutral-500">
                    Uso registrado; identificador e verificação indisponíveis no schema atual.
                  </div>
                )}
              </div>

              {/* Google Search Console */}
              <div className="p-2.5 rounded bg-[#000000] border border-[#1e1e1e] space-y-2">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={searchConsoleEnabled}
                      onChange={(e) => setSearchConsoleEnabled(e.target.checked)}
                      className="rounded bg-[#111111] border-[#333333] text-white focus:ring-0"
                    />
                    <span className="text-xs font-semibold text-neutral-200">Google Search Console</span>
                  </label>
                  <span className="text-[10px] font-mono text-neutral-500">Validação Manual/DNS</span>
                </div>
                {searchConsoleEnabled && (
                  <div className="pt-1.5 pl-6 border-t border-[#161616] flex items-center justify-between">
                    <span className="text-[11px] text-neutral-400 font-sans">
                      Propriedade configurada no Search Console:
                    </span>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-neutral-200 cursor-pointer">
                        <input
                          type="radio"
                          name="scConfig"
                          checked={searchConsoleConfigured === true}
                          onChange={() => setSearchConsoleConfigured(true)}
                          className="text-white bg-[#111111] border-[#333333] focus:ring-0"
                        />
                        <span>Sim</span>
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer">
                        <input
                          type="radio"
                          name="scConfig"
                          checked={searchConsoleConfigured === false}
                          onChange={() => setSearchConsoleConfigured(false)}
                          className="text-white bg-[#111111] border-[#333333] focus:ring-0"
                        />
                        <span>Não</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {!siteToEdit && (
            <div className="space-y-3 pt-3 border-t border-[#1e1e1e]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 font-mono flex items-center gap-1.5">
                    <KeyRound className="w-3 h-3" /> 4. Acessos Técnicos — opcional
                  </h3>
                  <p className="text-[11px] text-neutral-500 mt-0.5">
                    Os acessos serão vinculados ao novo site e enviados ao cofre somente depois que o cadastro for confirmado.
                  </p>
                </div>
                {!showAccessEditor && (
                  <button type="button" onClick={() => { setAccessDraft({ ...EMPTY_TECHNICAL_ACCESS }); setEditingAccessIndex(null); setShowAccessEditor(true); }} className="shrink-0 inline-flex items-center gap-1.5 rounded border border-[#303030] px-2.5 py-1.5 text-[10px] font-semibold text-neutral-200 hover:bg-[#161616]">
                    <Plus className="w-3 h-3" /> Adicionar acesso
                  </button>
                )}
              </div>

              {technicalAccesses.length > 0 && (
                <div className="space-y-2">
                  {technicalAccesses.map((access, index) => (
                    <div key={`${access.type}-${index}`} className="flex items-center justify-between gap-3 rounded border border-[#222] bg-black p-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-white truncate">{technicalAccessTitle(access)}</span>
                          <span className="text-[9px] font-mono text-neutral-500">{TECHNICAL_ACCESS_TYPE_LABELS[access.type]}</span>
                        </div>
                        <p className="mt-1 truncate text-[10px] font-mono text-neutral-500">
                          {access.url || (access.host ? `${access.host}:${access.port}` : access.username || 'Dados complementares preenchidos')} · Senha protegida
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button type="button" onClick={() => { setAccessDraft({ ...access }); setEditingAccessIndex(index); setShowAccessEditor(true); setAccessError(''); }} className="p-1.5 text-neutral-500 hover:text-white" title="Editar acesso"><Edit3 className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={() => { setTechnicalAccesses((current) => current.filter((_, itemIndex) => itemIndex !== index)); resetAccessDraft(); }} className="p-1.5 text-neutral-500 hover:text-rose-400" title="Remover acesso"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {showAccessEditor && (
                <div className="space-y-3 rounded border border-[#292929] bg-[#050505] p-3">
                  <TechnicalAccessFields value={accessDraft} onChange={(value) => { setAccessDraft(value); setAccessError(''); }} includePassword />
                  {accessError && <p className="text-[10px] font-mono text-rose-400">{accessError}</p>}
                  <p className="text-[10px] text-neutral-600">A senha permanece oculta e não será mantida na interface depois do envio ao cofre.</p>
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={resetAccessDraft} className="px-3 py-1.5 text-xs text-neutral-400 hover:text-white">Cancelar acesso</button>
                    <button type="button" onClick={saveAccessDraft} className="rounded bg-[#1d1d1d] border border-[#333] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#252525]">
                      {editingAccessIndex === null ? 'Adicionar à lista' : 'Salvar acesso'}
                    </button>
                  </div>
                </div>
              )}

              {!showAccessEditor && technicalAccesses.length === 0 && (
                <div className="rounded border border-dashed border-[#292929] p-4 text-center text-[11px] text-neutral-600">
                  Nenhum acesso será cadastrado agora. O site poderá recebê-los posteriormente em Detalhes do Site.
                </div>
              )}
            </div>
          )}

          {/* Form Actions */}
          <div className="pt-3 border-t border-[#1e1e1e] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-neutral-400 hover:text-white rounded hover:bg-[#161616] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-3.5 py-1.5 text-xs font-semibold bg-white text-black hover:bg-neutral-200 rounded transition-colors shadow-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              {isSaving ? 'Salvando...' : siteToEdit ? 'Salvar Alterações' : 'Cadastrar e Iniciar Monitoramento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
