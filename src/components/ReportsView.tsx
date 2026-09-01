import React, { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Site, Incident } from '../types';

interface ReportsViewProps {
  sites: Site[];
  incidents: Incident[];
  onSelectSite: (site: Site) => void;
}

function formatMinutes(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}min` : `${hours}h`;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ sites, incidents, onSelectSite }) => {
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const since = Date.now() - period * 24 * 60 * 60 * 1000;

  const periodIncidents = useMemo(
    () => incidents.filter((incident) => {
      const started = new Date(incident.startedAt).getTime();
      const resolved = incident.resolvedAtIso ? new Date(incident.resolvedAtIso).getTime() : Number.POSITIVE_INFINITY;
      return started <= Date.now() && resolved >= since;
    }),
    [incidents, since]
  );

  const downtimeMinutes = useMemo(() => periodIncidents.reduce((total, incident) => {
    const start = Math.max(new Date(incident.startedAt).getTime(), since);
    const end = incident.resolvedAtIso ? new Date(incident.resolvedAtIso).getTime() : Date.now();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return total;
    return total + Math.floor((end - start) / 60_000);
  }, 0), [periodIncidents, since]);

  const avgUptime30d = useMemo(() => {
    if (period !== 30) return null;
    const values = sites.map((site) => site.uptime30d).filter((value): value is number => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }, [period, sites]);

  const recentResponseValues = useMemo(() => sites.flatMap((site) => site.checksHistory)
    .filter((check) => new Date(check.checkedAt).getTime() >= since && check.responseTime > 0)
    .map((check) => check.responseTime), [sites, since]);
  const avgRecentResponse = recentResponseValues.length
    ? recentResponseValues.reduce((sum, value) => sum + value, 0) / recentResponseValues.length
    : null;

  const chartData = useMemo(() => {
    const bucketCount = period === 7 ? 7 : period === 30 ? 5 : 3;
    const bucketDays = period === 7 ? 1 : period === 30 ? 7 : 30;
    return Array.from({ length: bucketCount }, (_, index) => {
      const bucketStart = since + index * bucketDays * 86_400_000;
      const bucketEnd = index === bucketCount - 1 ? Date.now() : bucketStart + bucketDays * 86_400_000;
      return {
        label: new Date(bucketStart).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        incidentes: periodIncidents.filter((incident) => {
          const started = Math.max(new Date(incident.startedAt).getTime(), since);
          return started >= bucketStart && started < bucketEnd;
        }).length
      };
    });
  }, [period, periodIncidents, since]);

  const ranking = useMemo(() => sites.map((site) => {
    const siteIncidents = periodIncidents.filter((incident) => incident.siteId === site.id);
    const causes = new Map<string, number>();
    siteIncidents.forEach((incident) => causes.set(incident.type, (causes.get(incident.type) || 0) + 1));
    const mainCause = [...causes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Sem incidentes';
    return { site, count: siteIncidents.length, mainCause };
  }).filter((item) => item.count > 0).sort((a, b) => b.count - a.count), [sites, periodIncidents]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-[#1e1e1e]">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-sans">Relatórios Operacionais</h1>
          <p className="text-xs text-neutral-400 mt-0.5">Consolidação exclusiva de checks e incidentes persistidos.</p>
        </div>
        <div className="flex items-center gap-0.5 p-0.5 rounded bg-[#0a0a0a] border border-[#1e1e1e] text-[11px]">
          {([7, 30, 90] as const).map((days) => (
            <button key={days} onClick={() => setPeriod(days)} className={`px-2 py-1 rounded font-mono ${period === days ? 'bg-[#222222] text-white font-bold' : 'text-neutral-400'}`}>
              {days} dias
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-2.5">
        {[
          { label: 'Uptime médio', value: avgUptime30d === null ? (period === 30 ? 'Sem dados suficientes' : 'Indisponível') : `${avgUptime30d.toFixed(2)}%`, note: period === 30 ? 'Checks dos últimos 30 dias' : 'Disponível somente para 30 dias' },
          { label: 'Total de incidentes', value: String(periodIncidents.length), note: 'Ocorrências persistidas' },
          { label: 'Indisponibilidade total', value: formatMinutes(downtimeMinutes), note: 'Duração dos incidentes' },
          { label: 'Resposta média', value: avgRecentResponse === null ? 'Sem dados suficientes' : `${avgRecentResponse.toFixed(2)}s`, note: `${recentResponseValues.length} checks reais carregados` }
        ].map((card) => (
          <div key={card.label} className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e]">
            <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">{card.label}</span>
            <span className="text-lg sm:text-xl font-bold font-mono text-white block mt-1.5">{card.value}</span>
            <span className="text-[9px] text-neutral-500 block mt-0.5">{card.note}</span>
          </div>
        ))}
      </div>

      <div className="p-3.5 sm:p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-3">
        <div className="flex items-center gap-1.5"><BarChart3 className="w-4 h-4 text-neutral-400" /><h2 className="text-xs font-bold text-white uppercase font-mono">Incidentes no período</h2></div>
        {periodIncidents.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-xs font-mono text-neutral-500">Sem incidentes registrados no período.</div>
        ) : (
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 2" stroke="#1c1c1c" vertical={false} />
                <XAxis dataKey="label" stroke="#555555" fontSize={10} tickLine={false} />
                <YAxis stroke="#555555" fontSize={10} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ backgroundColor: '#050505', borderColor: '#262626', color: '#fff', fontSize: '11px' }} />
                <Bar dataKey="incidentes" fill="#ffffff" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="rounded border border-[#1e1e1e] bg-[#0a0a0a] overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead><tr className="border-b border-[#1e1e1e] bg-black text-[9px] font-mono uppercase text-neutral-400"><th className="py-2.5 px-3">Cliente / domínio</th><th className="py-2.5 px-3">Incidentes</th><th className="py-2.5 px-3">Causa mais frequente</th><th className="py-2.5 px-3 text-right">Ação</th></tr></thead>
          <tbody className="divide-y divide-[#181818]">
            {ranking.length === 0 ? <tr><td colSpan={4} className="py-6 text-center text-neutral-500 font-mono">Sem dados suficientes para ranking.</td></tr> : ranking.map(({ site, count, mainCause }) => (
              <tr key={site.id}><td className="py-2.5 px-3 text-white"><div>{site.client}</div><div className="text-[10px] font-mono text-neutral-500">{site.domain}</div></td><td className="py-2.5 px-3 font-mono">{count}</td><td className="py-2.5 px-3 text-neutral-300">{mainCause}</td><td className="py-2.5 px-3 text-right"><button onClick={() => onSelectSite(site)} className="px-2.5 py-1 rounded bg-[#161616] border border-[#222222] text-white">Ver histórico</button></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
