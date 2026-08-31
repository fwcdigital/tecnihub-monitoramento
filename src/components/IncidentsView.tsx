import React, { useState, useMemo } from 'react';
import { 
  AlertOctagon, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Filter, 
  Search, 
  ArrowUpRight, 
  Check, 
  Layers,
  RefreshCw,
  SlidersHorizontal
} from 'lucide-react';
import { Incident, IncidentType, IncidentSeverity } from '../types';

interface IncidentsViewProps {
  incidents: Incident[];
  onSelectIncident: (incident: Incident) => void;
  onResolveIncident: (incidentId: string) => void;
  onRecheckSite: (siteId: string) => void;
}

export const IncidentsView: React.FC<IncidentsViewProps> = ({
  incidents,
  onSelectIncident,
  onResolveIncident,
  onRecheckSite
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'resolved'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const incidentTypes: IncidentType[] = [
    'Site fora do ar',
    'HTTP 500',
    'HTTP 503',
    'Timeout',
    'Erro de conexão',
    'Site lento',
    'SSL vencido',
    'SSL próximo do vencimento',
    'Domínio vencido',
    'Domínio próximo do vencimento',
    'Redirecionamento inesperado',
    'Conteúdo esperado não encontrado'
  ];

  const activeIncidents = useMemo(() => {
    return incidents.filter(i => i.status === 'active');
  }, [incidents]);

  const resolvedIncidents = useMemo(() => {
    return incidents.filter(i => i.status === 'resolved');
  }, [incidents]);

  const filteredIncidents = useMemo(() => {
    return incidents.filter(i => {
      if (statusFilter !== 'all' && i.status !== statusFilter) return false;
      if (typeFilter !== 'all' && i.type !== typeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          i.client.toLowerCase().includes(q) ||
          i.siteName.toLowerCase().includes(q) ||
          i.type.toLowerCase().includes(q) ||
          i.url.toLowerCase().includes(q)
        );
      }
      return true;
    }).sort((a, b) => {
      // Active first, then by date/id
      if (a.status === 'active' && b.status === 'resolved') return -1;
      if (a.status === 'resolved' && b.status === 'active') return 1;
      return 0;
    });
  }, [incidents, statusFilter, typeFilter, searchQuery]);

  return (
    <div className="space-y-4 sm:space-y-5">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-[#1e1e1e]">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-sans">
            Central de Incidentes
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">
            Registro detalhado de indisponibilidades, anomalias HTTP, lentidões e expirações.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#0a0a0a] border border-[#1e1e1e] text-[11px] font-mono">
            <span className="text-neutral-500">Ativos:</span>
            <span className="text-amber-400 font-bold">{activeIncidents.length}</span>
            <span className="text-neutral-600 mx-1">•</span>
            <span className="text-neutral-500">Resolvidos:</span>
            <span className="text-emerald-400 font-bold">{resolvedIncidents.length}</span>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2.5">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por cliente, domínio ou tipo de anomalia..."
            className="w-full pl-9 pr-3 py-1.5 bg-[#000000] border border-[#222222] rounded text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-neutral-500 transition-colors"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Status filter tabs */}
          <div className="flex items-center gap-0.5 p-0.5 rounded bg-[#000000] border border-[#1e1e1e] text-[11px]">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2 py-1 rounded font-medium transition-colors ${
                statusFilter === 'all'
                  ? 'bg-[#222222] text-white font-bold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Todos ({incidents.length})
            </button>
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-2 py-1 rounded font-medium transition-colors ${
                statusFilter === 'active'
                  ? 'bg-amber-500 text-black font-bold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Problemas Atuais ({activeIncidents.length})
            </button>
            <button
              onClick={() => setStatusFilter('resolved')}
              className={`px-2 py-1 rounded font-medium transition-colors ${
                statusFilter === 'resolved'
                  ? 'bg-[#222222] text-white font-bold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Histórico ({resolvedIncidents.length})
            </button>
          </div>

          {/* Type dropdown */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-[#000000] border border-[#222222] rounded text-xs text-white focus:outline-none focus:border-neutral-500 font-mono"
          >
            <option value="all">Todos os Tipos de Erro</option>
            {incidentTypes.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Incidents List */}
      <div className="space-y-3">
        
        {/* If viewing All or Active and there are active incidents, show highlight header */}
        {statusFilter !== 'resolved' && activeIncidents.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase font-bold text-amber-400 tracking-wider">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Problemas Atuais em Andamento ({activeIncidents.length})</span>
          </div>
        )}

        <div className="space-y-2">
          {filteredIncidents.length === 0 ? (
            <div className="p-8 text-center rounded bg-[#0a0a0a] border border-[#1e1e1e] text-neutral-500 text-xs font-mono">
              Nenhum incidente registrado com os critérios atuais.
            </div>
          ) : (
            filteredIncidents.map((incident) => {
              const isCrit = incident.severity === 'critical';
              const isResolved = incident.status === 'resolved';

              return (
                <div
                  key={incident.id}
                  onClick={() => onSelectIncident(incident)}
                  className={`p-3.5 rounded border transition-all cursor-pointer group ${
                    isCrit && !isResolved
                      ? 'bg-rose-950/20 border-rose-800/40 hover:border-rose-600'
                      : isResolved
                      ? 'bg-[#0a0a0a] border-[#1e1e1e] hover:border-[#333333]'
                      : 'bg-amber-950/15 border-amber-800/35 hover:border-amber-600'
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    
                    {/* Left: Indicator & Description */}
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded shrink-0 mt-0.5 ${
                        isCrit && !isResolved
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : isResolved
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}>
                        {isCrit && !isResolved ? (
                          <AlertOctagon className="w-4 h-4" />
                        ) : isResolved ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : (
                          <AlertTriangle className="w-4 h-4" />
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono uppercase font-bold text-neutral-300">
                            {incident.client}
                          </span>
                          <span className="text-[10px] font-mono text-neutral-500">
                            • {incident.siteName}
                          </span>
                          <span className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold uppercase ${
                            isCrit && !isResolved
                              ? 'bg-rose-500 text-white'
                              : isResolved
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          }`}>
                            {isResolved ? 'Resolvido' : isCrit ? 'Crítico' : 'Atenção'}
                          </span>
                        </div>

                        <h3 className="text-sm font-semibold text-white mt-0.5">
                          {incident.type}
                        </h3>

                        <p className="text-[11px] text-neutral-400 mt-0.5 font-mono">
                          {incident.currentStatus}
                        </p>
                      </div>
                    </div>

                    {/* Right: Telemetry metrics & action buttons */}
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 text-xs font-mono text-neutral-400 self-end md:self-center shrink-0">
                      <div className="text-right">
                        <span className="text-[9px] text-neutral-500 block uppercase">Início / Duração</span>
                        <span className="font-semibold text-neutral-200 text-[11px]">{incident.createdAt} ({incident.duration})</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {!isResolved && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onResolveIncident(incident.id);
                            }}
                            className="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 text-xs font-medium flex items-center gap-1 transition-colors"
                            title="Marcar como resolvido"
                          >
                            <Check className="w-3 h-3" />
                            Resolver
                          </button>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectIncident(incident);
                          }}
                          className="px-2.5 py-1 rounded bg-[#161616] hover:bg-[#222222] border border-[#222222] text-white text-xs font-medium flex items-center gap-1 transition-colors"
                        >
                          Detalhes
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
