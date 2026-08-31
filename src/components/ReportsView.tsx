import React, { useState, useMemo } from 'react';
import { 
  BarChart3, 
  Clock, 
  TrendingUp, 
  AlertTriangle, 
  ShieldCheck, 
  Download, 
  Calendar,
  Layers
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid 
} from 'recharts';
import { Site, Incident } from '../types';

interface ReportsViewProps {
  sites: Site[];
  incidents: Incident[];
  onSelectSite: (site: Site) => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  sites,
  incidents,
  onSelectSite
}) => {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');

  // Operational metrics based on period
  const totalIncidentsCount = useMemo(() => {
    if (period === '7d') return 3;
    if (period === '30d') return 6;
    return 14;
  }, [period]);

  const totalDowntimeMinutes = useMemo(() => {
    if (period === '7d') return '24 min';
    if (period === '30d') return '1h 18min';
    return '3h 42min';
  }, [period]);

  const avgUptimePeriod = useMemo(() => {
    if (period === '7d') return '99,94%';
    if (period === '30d') return '99,92%';
    return '99,89%';
  }, [period]);

  const avgResponseTimePeriod = useMemo(() => {
    if (period === '7d') return '1,28s';
    if (period === '30d') return '1,32s';
    return '1,35s';
  }, [period]);

  // Chart data: Incident frequency by timeframe
  const incidentChartData = useMemo(() => {
    if (period === '7d') {
      return [
        { label: 'Seg', incidentes: 0 },
        { label: 'Ter', incidentes: 1 },
        { label: 'Qua', incidentes: 0 },
        { label: 'Qui', incidentes: 0 },
        { label: 'Sex', incidentes: 1 },
        { label: 'Sáb', incidentes: 0 },
        { label: 'Dom', incidentes: 1 },
      ];
    } else if (period === '30d') {
      return [
        { label: 'Sem 1', incidentes: 1 },
        { label: 'Sem 2', incidentes: 2 },
        { label: 'Sem 3', incidentes: 1 },
        { label: 'Sem 4', incidentes: 2 },
      ];
    } else {
      return [
        { label: 'Jun', incidentes: 4 },
        { label: 'Jul', incidentes: 5 },
        { label: 'Ago', incidentes: 5 },
      ];
    }
  }, [period]);

  // Ranking: Sites com mais incidentes
  const topTroubledSites = useMemo(() => {
    return [
      {
        siteId: 'site-xyz',
        client: 'Cliente XYZ',
        siteName: 'Portal Alpha Distribuição',
        domain: 'clientexyz.com.br',
        incidentCount: 3,
        totalDowntime: '42 min',
        mainIssue: 'HTTP 503 / VPS instável'
      },
      {
        siteId: 'site-torge',
        client: 'Torge Sistemas',
        siteName: 'Torge ERP & Cloud',
        domain: 'torge.com.br',
        incidentCount: 2,
        totalDowntime: '0 min (Lentidão)',
        mainIssue: 'Tempo de resposta > 5s'
      },
      {
        siteId: 'site-neovanguard',
        client: 'NeoVanguard Arquitetura',
        siteName: 'Studio NeoVanguard',
        domain: 'neovanguard.com.br',
        incidentCount: 1,
        totalDowntime: '0 min (SSL)',
        mainIssue: 'SSL próximo da expiração'
      },
      {
        siteId: 'site-bellavista',
        client: 'Bella Vista Gastronomia',
        siteName: 'Restaurante Bella Vista',
        domain: 'bellavistagastro.com.br',
        incidentCount: 1,
        totalDowntime: '8 min',
        mainIssue: 'Timeout de gateway'
      }
    ];
  }, []);

  return (
    <div className="space-y-4 sm:space-y-5">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-[#1e1e1e]">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-sans">
            Relatórios Operacionais
          </h1>
          <p className="text-xs text-neutral-400 mt-0.5">
            Histórico consolidado de estabilidade e qualidade técnica da infraestrutura dos clientes TECNIHUB.
          </p>
        </div>

        {/* Period toggle buttons */}
        <div className="flex items-center gap-0.5 p-0.5 rounded bg-[#0a0a0a] border border-[#1e1e1e] text-[11px]">
          {(['7d', '30d', '90d'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2 py-1 rounded font-mono font-medium transition-colors ${
                period === p
                  ? 'bg-[#222222] text-white font-bold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              {p === '7d' ? '7 dias' : p === '30d' ? '30 dias' : '90 dias'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards Grid - High Density */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-2.5">
        
        {/* UPTIME MÉDIO */}
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
          <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
            Uptime Médio
          </span>
          <div className="mt-1.5">
            <span className="text-xl sm:text-2xl font-bold font-mono text-emerald-400">
              {avgUptimePeriod}
            </span>
            <span className="text-[9px] text-neutral-500 block mt-0.5">Disponibilidade global</span>
          </div>
        </div>

        {/* QUANTIDADE DE INCIDENTES */}
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
          <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
            Total de Incidentes
          </span>
          <div className="mt-1.5">
            <span className="text-xl sm:text-2xl font-bold font-mono text-white">
              {totalIncidentsCount}
            </span>
            <span className="text-[9px] text-neutral-500 block mt-0.5">Ocorrências registradas</span>
          </div>
        </div>

        {/* TEMPO TOTAL DE INDISPONIBILIDADE */}
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
          <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
            Indisponibilidade Total
          </span>
          <div className="mt-1.5">
            <span className="text-xl sm:text-2xl font-bold font-mono text-amber-400">
              {totalDowntimeMinutes}
            </span>
            <span className="text-[9px] text-neutral-500 block mt-0.5">Soma de tempo offline</span>
          </div>
        </div>

        {/* TEMPO MÉDIO DE RESPOSTA */}
        <div className="p-3 rounded bg-[#0a0a0a] border border-[#1e1e1e] flex flex-col justify-between">
          <span className="text-[9px] font-mono uppercase tracking-wider text-neutral-400 font-semibold">
            Tempo Médio Resposta
          </span>
          <div className="mt-1.5">
            <span className="text-xl sm:text-2xl font-bold font-mono text-white">
              {avgResponseTimePeriod}
            </span>
            <span className="text-[9px] text-neutral-500 block mt-0.5">Latência global média</span>
          </div>
        </div>
      </div>

      {/* Incidentes por Período (Gráfico) */}
      <div className="p-3.5 sm:p-4 rounded bg-[#0a0a0a] border border-[#1e1e1e] space-y-3">
        <div>
          <h2 className="text-xs font-bold text-white tracking-tight uppercase font-mono">
            Incidentes por Período ({period === '7d' ? 'Últimos 7 dias' : period === '30d' ? 'Últimos 30 dias' : 'Últimos 90 dias'})
          </h2>
          <p className="text-[11px] text-neutral-400 mt-0.5">
            Distribuição temporal de anomalias registradas
          </p>
        </div>

        <div className="h-52 w-full pt-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={incidentChartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 2" stroke="#1c1c1c" vertical={false} />
              <XAxis dataKey="label" stroke="#555555" fontSize={10} tickLine={false} />
              <YAxis stroke="#555555" fontSize={10} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#050505',
                  borderColor: '#262626',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '11px',
                  fontFamily: 'JetBrains Mono'
                }}
                formatter={(val: any) => [`${val} ocorrência(s)`, 'Incidentes']}
              />
              <Bar dataKey="incidentes" fill="#ffffff" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Sites com Mais Incidentes (Ranking) */}
      <div className="space-y-2.5">
        <div>
          <h2 className="text-xs font-bold text-white tracking-tight uppercase font-mono">
            Sites com Mais Incidentes no Período
          </h2>
          <p className="text-[11px] text-neutral-400">
            Identifique clientes cuja hospedagem ou código necessita de intervenção proativa
          </p>
        </div>

        <div className="rounded border border-[#1e1e1e] bg-[#0a0a0a] overflow-hidden shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#1e1e1e] bg-[#000000] text-[9px] font-mono uppercase tracking-wider text-neutral-400">
                <th className="py-2.5 px-3 font-semibold">Cliente / Domínio</th>
                <th className="py-2.5 px-3 font-semibold">Qtd. Incidentes</th>
                <th className="py-2.5 px-3 font-semibold">Tempo Fora</th>
                <th className="py-2.5 px-3 font-semibold">Principal Causa</th>
                <th className="py-2.5 px-3 text-right font-semibold">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#181818] font-sans">
              {topTroubledSites.map((item, idx) => {
                const targetSite = sites.find(s => s.id === item.siteId);

                return (
                  <tr key={idx} className="hover:bg-[#121212] transition-colors">
                    <td className="py-2.5 px-3 font-medium text-white">
                      <div className="text-xs">{item.client}</div>
                      <div className="text-[10px] font-mono text-neutral-500">{item.domain}</div>
                    </td>

                    <td className="py-2.5 px-3 font-mono font-bold text-amber-400 text-xs">
                      {item.incidentCount}
                    </td>

                    <td className="py-2.5 px-3 font-mono text-neutral-300 text-xs">
                      {item.totalDowntime}
                    </td>

                    <td className="py-2.5 px-3 text-neutral-300 font-mono text-[11px]">
                      {item.mainIssue}
                    </td>

                    <td className="py-2.5 px-3 text-right">
                      {targetSite && (
                        <button
                          onClick={() => onSelectSite(targetSite)}
                          className="px-2.5 py-1 text-[11px] font-medium rounded bg-[#161616] hover:bg-[#222222] border border-[#222222] text-white transition-colors"
                        >
                          Ver Histórico
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
