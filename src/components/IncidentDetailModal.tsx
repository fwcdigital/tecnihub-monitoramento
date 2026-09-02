import React from 'react';
import { X, AlertOctagon, AlertTriangle, CheckCircle2, Clock, Globe, Server, ArrowRight, RefreshCw } from 'lucide-react';
import { Incident } from '../types';

interface IncidentDetailModalProps {
  incident: Incident | null;
  isOpen: boolean;
  onClose: () => void;
  onRecheckSite: (siteId: string) => void;
}

export const IncidentDetailModal: React.FC<IncidentDetailModalProps> = ({
  incident,
  isOpen,
  onClose,
  onRecheckSite
}) => {
  if (!isOpen || !incident) return null;

  const isCritical = incident.severity === 'critical';
  const isResolved = incident.status === 'resolved';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/85 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-[#0a0a0a] border border-[#1e1e1e] rounded shadow-2xl overflow-hidden my-4">
        
        {/* Header */}
        <div className={`px-4 py-3 border-b flex items-center justify-between ${
          isCritical && !isResolved
            ? 'bg-rose-950/20 border-rose-900/30'
            : isResolved
            ? 'bg-[#000000] border-[#1e1e1e]'
            : 'bg-amber-950/20 border-amber-900/30'
        }`}>
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded ${
              isCritical && !isResolved
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                : isResolved
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
            }`}>
              {isCritical && !isResolved ? (
                <AlertOctagon className="w-4 h-4" />
              ) : isResolved ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono uppercase font-bold text-neutral-400">
                  {incident.client}
                </span>
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold uppercase ${
                  isCritical && !isResolved
                    ? 'bg-rose-500 text-white'
                    : isResolved
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                }`}>
                  {isResolved ? 'Resolvido' : isCritical ? 'Crítico' : 'Atenção'}
                </span>
              </div>
              <h2 className="text-sm font-bold text-white mt-0.5">
                {incident.type}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded hover:bg-[#161616] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 max-h-[calc(85vh-90px)] overflow-y-auto">
          
          {/* Site identity */}
          <div className="p-3 rounded bg-[#000000] border border-[#1e1e1e] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Globe className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-white font-sans">{incident.siteName}</p>
                <a
                  href={incident.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-mono text-neutral-400 hover:text-white underline underline-offset-2"
                >
                  {incident.url}
                </a>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[9px] uppercase font-mono text-neutral-500 block">Duração</span>
              <span className="text-xs font-mono font-bold text-neutral-200">{incident.duration}</span>
            </div>
          </div>

          {/* Diagnosis & Explanation */}
          <div className="space-y-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 font-mono">
              Diagnóstico Operacional
            </h3>
            <div className="p-3 rounded bg-[#000000] border border-[#1e1e1e] text-neutral-200">
              <p className="text-xs leading-relaxed font-sans">
                "{incident.explanation}"
              </p>
            </div>
          </div>

          {/* Technical Telemetry Grid */}
          <div className="space-y-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 font-mono">
              Parâmetros Técnicos Registrados
            </h3>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <div className="p-2.5 rounded bg-[#000000] border border-[#1e1e1e]">
                <span className="text-[9px] font-mono uppercase text-neutral-500 block">Código HTTP</span>
                <span className="text-xs font-mono font-bold text-white mt-0.5 block">
                  {incident.httpReturned}
                </span>
              </div>

              <div className="p-2.5 rounded bg-[#000000] border border-[#1e1e1e]">
                <span className="text-[9px] font-mono uppercase text-neutral-500 block">Falhas carregadas</span>
                <span className="text-xs font-mono font-bold text-rose-400 mt-0.5 block">
                  {incident.failedChecksCount === null ? 'Sem dados suficientes' : `${incident.failedChecksCount} tentativas`}
                </span>
              </div>

              <div className="p-2.5 rounded bg-[#000000] border border-[#1e1e1e]">
                <span className="text-[9px] font-mono uppercase text-neutral-500 block">Status Atual</span>
                <span className="text-[11px] font-mono font-medium text-neutral-200 mt-0.5 block truncate" title={incident.currentStatus}>
                  {incident.currentStatus}
                </span>
              </div>
              {incident.technicalCode && (
                <div className="p-2.5 rounded bg-[#000000] border border-[#1e1e1e]">
                  <span className="text-[9px] font-mono uppercase text-neutral-500 block">Código técnico</span>
                  <span className="text-xs font-mono text-neutral-300 mt-0.5 block">
                    {incident.technicalCode}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Timeline Sequence */}
          <div className="space-y-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 font-mono">
              Linha do Tempo da Ocorrência
            </h3>

            <div className="p-3 rounded bg-[#000000] border border-[#1e1e1e] space-y-2 font-mono text-[11px]">
              <div className="flex items-center justify-between text-neutral-300 pb-1.5 border-b border-[#1e1e1e]">
                <span className="text-neutral-500">Início da Anomalia:</span>
                <span className="font-semibold text-white">{incident.createdAt}</span>
              </div>

              <div className="flex items-center justify-between text-neutral-300 pb-1.5 border-b border-[#1e1e1e]">
                <span className="text-neutral-500">Primeira Verificação com Erro:</span>
                <span className="font-semibold text-rose-400">{incident.firstErrorCheck}</span>
              </div>

              <div className="flex items-center justify-between text-neutral-300 pb-1.5 border-b border-[#1e1e1e]">
                <span className="text-neutral-500">Última Verificação Bem-Sucedida:</span>
                <span className="font-semibold text-emerald-400">{incident.lastSuccessfulCheck}</span>
              </div>

              {incident.resolvedAt && (
                <div className="flex items-center justify-between text-neutral-300">
                  <span className="text-neutral-500">Normalização / Resolução:</span>
                  <span className="font-semibold text-emerald-400">{incident.resolvedAt}</span>
                </div>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-[#1e1e1e] flex flex-wrap items-center justify-between gap-2">
            <button
              onClick={() => onRecheckSite(incident.siteId)}
              className="px-2.5 py-1.5 text-xs font-medium text-neutral-200 bg-[#161616] hover:bg-[#222222] border border-[#222222] rounded transition-colors flex items-center gap-1.5 font-mono cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              Executar Ping de Verificação
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs font-medium bg-[#161616] text-white hover:bg-[#222222] border border-[#222222] rounded transition-colors cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
