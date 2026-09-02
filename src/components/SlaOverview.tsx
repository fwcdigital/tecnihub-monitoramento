import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import { getSiteSlaReport } from '../services/siteService';
import { Site, SiteSlaReport, SlaIncidentHistoryItem, SlaPeriodKey } from '../types';
import { diagnosticTypeLabel } from '../utils/diagnosticLabels';

interface SlaOverviewProps {
  sites: Site[];
  onRecheckSite: (siteId: string) => void;
}

const periods: Array<{ value: SlaPeriodKey; label: string }> = [
  { value: '24h', label: 'Últimas 24 horas' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'current_month', label: 'Mês atual' },
  { value: 'previous_month', label: 'Mês anterior' }
];

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Dados insuficientes';
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 5 })}%`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'Dados insuficientes';
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function humanCause(incident: SlaIncidentHistoryItem): string {
  const normalized = String(incident.humanCause || '').replace(/^Indisponibilidade confirmada:\s*/i, '').trim();
  const looksTechnical = /\b(?:E[A-Z0-9_]{2,}|ERR_[A-Z0-9_]+|TLS_ERROR|DNS_[A-Z_]+|CONNECTION_ERROR)\b/i.test(normalized);
  return normalized && !looksTechnical
    ? normalized
    : diagnosticTypeLabel(incident.technicalCode, 'offline', null);
}

export const SlaOverview: React.FC<SlaOverviewProps> = ({ sites, onRecheckSite }) => {
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [period, setPeriod] = useState<SlaPeriodKey>('30d');
  const [report, setReport] = useState<SiteSlaReport | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sites.length) {
      setSelectedSiteId('');
      setReport(null);
      return;
    }
    if (!sites.some((site) => site.id === selectedSiteId)) setSelectedSiteId(sites[0].id);
  }, [sites, selectedSiteId]);

  useEffect(() => {
    if (!selectedSiteId) return;
    let active = true;
    setLoading(true);
    setError('');
    setReport(null);
    getSiteSlaReport(selectedSiteId, period, offset)
      .then(({ report: nextReport }) => {
        if (active) setReport(nextReport);
      })
      .catch((requestError: Error) => {
        if (active) {
          setReport(null);
          setError(requestError.message || 'Não foi possível calcular o SLA.');
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedSiteId, period, offset]);

  const status = report?.summary.slaStatus;
  const statusLabel = status === 'within_sla'
    ? 'Dentro do SLA'
    : status === 'below_sla' ? 'Fora do SLA' : 'Dados insuficientes';
  const margin = report?.summary.remainingOrExceededSeconds ?? null;
  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId),
    [sites, selectedSiteId]
  );

  if (!sites.length) {
    return <div className="p-5 rounded bg-[#0a0a0a] border border-[#1e1e1e] text-xs text-neutral-500">Cadastre um site para acompanhar SLA.</div>;
  }

  return (
    <section className="space-y-3 rounded border border-[#1e1e1e] bg-[#080808] p-3.5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-white">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-bold">Disponibilidade e SLA por site</h2>
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">
            Calculado pelos intervalos reais dos incidentes confirmados, sem contar warnings como indisponibilidade.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={selectedSiteId}
            onChange={(event) => { setSelectedSiteId(event.target.value); setOffset(0); }}
            className="min-w-56 rounded border border-[#292929] bg-black px-2.5 py-1.5 text-xs text-white"
          >
            {sites.map((site) => <option key={site.id} value={site.id}>{site.client} — {site.domain}</option>)}
          </select>
          <select
            value={period}
            onChange={(event) => { setPeriod(event.target.value as SlaPeriodKey); setOffset(0); }}
            className="rounded border border-[#292929] bg-black px-2.5 py-1.5 text-xs text-white"
          >
            {periods.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="rounded border border-rose-900/50 bg-rose-950/20 p-3 text-xs text-rose-300">{error}</div>}
      {loading && !report && <div className="p-5 text-center text-xs text-neutral-500">Calculando disponibilidade...</div>}

      {report && (
        <>
          {!report.period.hasFullCoverage && (
            <div className="flex items-start gap-2 rounded border border-amber-800/40 bg-amber-950/15 p-2.5 text-[11px] text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {report.period.hasContinuousCoverage
                ? 'O site não possui cobertura nas duas bordas do período. A disponibilidade parcial é informativa e não recebe classificação de SLA.'
                : `Foram detectadas ${report.period.abnormalGapCount} lacuna(s) anormal(is) no monitoramento${report.period.largestGapSeconds ? `; a maior durou ${formatDuration(report.period.largestGapSeconds)}` : ''}. A disponibilidade não é calculada porque parte do tempo não foi observada.`}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            {[
              ['Disponibilidade', formatPercent(report.summary.availabilityPercent)],
              ['Meta SLA', `${Number(report.site.slaTargetPercent).toLocaleString('pt-BR')}%`],
              ['Incidentes', String(report.summary.incidentCount)],
              ['Downtime total', formatDuration(report.summary.downtimeSeconds)],
              ['MTTR', formatDuration(report.summary.mttrSeconds)]
            ].map(([label, value]) => (
              <div key={label} className="rounded border border-[#202020] bg-black p-2.5">
                <span className="block text-[9px] uppercase tracking-wide text-neutral-500">{label}</span>
                <strong className="mt-1 block text-sm text-white">{value}</strong>
              </div>
            ))}
          </div>

          <div className="grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
            <div className={`rounded border p-2.5 ${status === 'within_sla' ? 'border-emerald-800/40 bg-emerald-950/15 text-emerald-300' : status === 'below_sla' ? 'border-rose-800/40 bg-rose-950/15 text-rose-300' : 'border-[#252525] bg-black text-neutral-400'}`}>
              <span className="block text-[9px] uppercase opacity-70">Status</span>{statusLabel}
            </div>
            <div className="rounded border border-[#252525] bg-black p-2.5 text-neutral-300">
              <span className="block text-[9px] uppercase text-neutral-500">Downtime permitido</span>
              {formatDuration(report.summary.allowedDowntimeSeconds)}
            </div>
            <div className="rounded border border-[#252525] bg-black p-2.5 text-neutral-300">
              <span className="block text-[9px] uppercase text-neutral-500">Margem</span>
              {margin === null
                ? 'Dados insuficientes'
                : margin >= 0 ? `${formatDuration(margin)} restante` : `${formatDuration(Math.abs(margin))} excedida`}
            </div>
            <div className="rounded border border-[#252525] bg-black p-2.5 text-neutral-300">
              <span className="block text-[9px] uppercase text-neutral-500">Maior / média</span>
              {formatDuration(report.summary.longestIncidentSeconds)} / {formatDuration(report.summary.averageIncidentSeconds)}
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-white">Histórico no período</h3>
              <span className="text-[10px] text-neutral-500">{report.pagination.total} incidente(s) · {report.summary.openIncidents} aberto(s) agora</span>
            </div>
            {!report.incidents.length ? (
              <div className="rounded border border-[#202020] bg-black p-4 text-center text-xs text-neutral-500">Nenhum incidente confirmado no período.</div>
            ) : report.incidents.map((incident) => (
              <div key={incident.id} className="rounded border border-[#202020] bg-black p-3">
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      {incident.status === 'active'
                        ? <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                        : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                      <strong className="text-xs text-white">{humanCause(incident)}</strong>
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${incident.status === 'active' ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                        {incident.status === 'active' ? 'Em andamento' : 'Recuperado'}
                      </span>
                    </div>
                    {incident.technicalCode && <p className="mt-1 text-[10px] font-mono text-neutral-600">Detalhe técnico: {incident.technicalCode}</p>}
                  </div>
                  <div className="text-[10px] text-neutral-400 sm:text-right">
                    <span className="block">Início: {new Date(incident.startedAt).toLocaleString('pt-BR')}</span>
                    <span className="block">Recuperação: {incident.resolvedAt ? new Date(incident.resolvedAt).toLocaleString('pt-BR') : 'Em andamento'}</span>
                    <span className="block">Duração: {incident.status === 'active' ? 'Em andamento' : formatDuration(incident.durationSeconds)}</span>
                  </div>
                </div>
                {incident.status === 'active' && selectedSite && (
                  <button onClick={() => onRecheckSite(selectedSite.id)} className="mt-2 inline-flex items-center gap-1 rounded border border-[#292929] px-2 py-1 text-[10px] text-neutral-300 hover:text-white">
                    <RefreshCw className="h-3 w-3" /> Verificar agora
                  </button>
                )}
              </div>
            ))}
            {report.pagination.total > report.pagination.limit && (
              <div className="flex justify-end gap-2">
                <button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 50))} className="rounded border border-[#292929] px-2 py-1 text-[10px] text-neutral-300 disabled:opacity-40">Anterior</button>
                <button disabled={!report.pagination.hasMore || loading} onClick={() => setOffset(offset + 50)} className="rounded border border-[#292929] px-2 py-1 text-[10px] text-neutral-300 disabled:opacity-40">Próxima</button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
};
