import React, { useEffect, useState } from 'react';
import { Trash2, X, AlertTriangle } from 'lucide-react';
import { Site, SiteDeletionImpact } from '../types';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  site: Site | null;
  impact: SiteDeletionImpact | null;
  isLoadingImpact?: boolean;
  onClose: () => void;
  onConfirm: (siteId: string, confirmation: string) => Promise<void> | void;
  isDeleting?: boolean;
}

export const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  isOpen,
  site,
  impact,
  isLoadingImpact = false,
  onClose,
  onConfirm,
  isDeleting = false
}) => {
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    setConfirmation('');
  }, [isOpen, site?.id]);

  if (!isOpen || !site) return null;
  const normalizedConfirmation = confirmation.trim().toLowerCase();
  const confirmationMatches = normalizedConfirmation === site.domain.trim().toLowerCase()
    || normalizedConfirmation === site.siteName.trim().toLowerCase();
  const impactReady = impact?.siteId === site.id;
  const plural = (value: number, singular: string, pluralLabel: string) => `${value} ${value === 1 ? singular : pluralLabel}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xs">
      <div className="relative w-full max-w-md bg-[#0a0a0a] border border-[#222222] rounded shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#1e1e1e] flex items-center justify-between bg-[#000000]">
          <div className="flex items-center gap-2 text-rose-400">
            <AlertTriangle className="w-4 h-4" />
            <h2 className="text-sm font-bold text-white font-sans">
              Confirmar Exclusão de Site
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="p-1 text-neutral-400 hover:text-white rounded hover:bg-[#161616] transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          <p className="text-xs text-neutral-300">
            Para preservar o cadastro e o histórico, cancele e use <strong className="text-white">Desativar monitoramento</strong>.
          </p>

          <div className="p-3 rounded bg-[#000000] border border-[#1e1e1e] space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white font-sans">{site.siteName}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#161616] text-neutral-400 border border-[#222222]">
                {site.client}
              </span>
            </div>
            <p className="text-[11px] font-mono text-neutral-400">{site.url}</p>
          </div>

          <div className="text-[11px] text-rose-300 bg-rose-950/20 border border-rose-900/40 p-3 rounded space-y-2">
            {isLoadingImpact || !impactReady ? (
              <p className="font-mono">Calculando todo o histórico vinculado...</p>
            ) : (
              <>
                <p className="font-semibold text-rose-200">
                  Esta ação excluirá permanentemente este site e todo o histórico relacionado, incluindo:
                </p>
                <ul className="font-mono space-y-0.5 list-disc pl-4">
                  <li>{plural(impact.checks, 'verificação', 'verificações')}</li>
                  <li>{plural(impact.incidents, 'incidente', 'incidentes')}</li>
                  <li>{plural(impact.alertEvents + impact.alertDeliveries, 'registro de alerta', 'registros de alertas')}</li>
                  <li>{plural(impact.credentials, 'acesso técnico', 'acessos técnicos')}</li>
                  {impact.credentialAudit > 0 && (
                    <li>{plural(impact.credentialAudit, 'registro de auditoria de acesso', 'registros de auditoria de acessos')}</li>
                  )}
                </ul>
                <p className="font-bold text-rose-200">Esta ação não pode ser desfeita.</p>
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-[11px] text-neutral-300 font-mono">
              Para confirmar, digite <strong className="text-white">{site.domain}</strong> ou <strong className="text-white">{site.siteName}</strong>
            </label>
            <input
              type="text"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={isDeleting}
              autoComplete="off"
              className="w-full px-2.5 py-1.5 bg-[#000000] border border-[#333333] rounded text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-500 font-mono disabled:opacity-50"
              placeholder={site.domain}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t border-[#1e1e1e] bg-[#000000] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-3 py-1.5 text-xs font-medium text-neutral-400 hover:text-white bg-[#111111] hover:bg-[#1a1a1a] border border-[#222222] rounded transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(site.id, confirmation.trim())}
            disabled={isDeleting || isLoadingImpact || !impactReady || !confirmationMatches}
            className="px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {isDeleting ? 'Excluindo...' : 'Excluir Definitivamente'}
          </button>
        </div>
      </div>
    </div>
  );
};
