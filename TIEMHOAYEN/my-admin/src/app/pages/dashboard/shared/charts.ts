import { ChartConfiguration, ChartType } from 'chart.js';
import { compact, money, num, PALETTE } from './format';

/** Cấu hình Chart.js dùng chung — cùng phong cách cho 3 trang. */

const axisMoney = (isMoney: boolean) => (v: string | number) => (isMoney ? compact(Number(v)) : num(Number(v)));
const tip = (isMoney: boolean, unit = '') => (c: any) => {
  const v = Number(c.parsed?.y ?? c.parsed?.x ?? c.raw);
  const val = c.chart.config.type === 'bar' && c.chart.options.indexAxis === 'y' ? Number(c.parsed.x) : v;
  return `${c.dataset.label ? c.dataset.label + ': ' : ''}${isMoney ? money(val) : num(val) + (unit ? ' ' + unit : '')}`;
};

export const lineOptions = (isMoney = true, unit = ''): ChartConfiguration<'line'>['options'] => ({
  responsive: true, maintainAspectRatio: false, animation: { duration: 250 }, interaction: { mode: 'index', intersect: false },
  plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 14, font: { size: 12 } } }, tooltip: { callbacks: { label: tip(isMoney, unit) } } },
  scales: {
    x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12, font: { size: 11 } } },
    y: { beginAtZero: true, grid: { color: '#F1ECEA' }, ticks: { font: { size: 11 }, callback: axisMoney(isMoney) } },
  },
});

export const barOptions = (opts: { money?: boolean; horizontal?: boolean; stacked?: boolean; legend?: boolean; unit?: string } = {}): ChartConfiguration<'bar'>['options'] => ({
  responsive: true, maintainAspectRatio: false, animation: { duration: 250 }, indexAxis: opts.horizontal ? 'y' : 'x', interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: opts.legend ?? false, position: 'top', align: 'end', labels: { boxWidth: 14, font: { size: 12 } } },
    tooltip: { callbacks: { label: tip(!!opts.money, opts.unit) } },
  },
  scales: {
    x: { stacked: opts.stacked, grid: { display: !!opts.horizontal, color: '#F1ECEA' }, beginAtZero: true, ticks: { font: { size: 11 }, autoSkip: true, maxRotation: 0, ...(opts.horizontal ? { callback: axisMoney(!!opts.money) } : {}) } },
    y: { stacked: opts.stacked, grid: { display: !opts.horizontal, color: '#F1ECEA' }, beginAtZero: true, ticks: { font: { size: 11 }, ...(!opts.horizontal ? { callback: axisMoney(!!opts.money) } : {}) } },
  },
});

export const doughnutOptions = (isMoney = true): ChartConfiguration<'doughnut'>['options'] => ({
  responsive: true, maintainAspectRatio: false, animation: { duration: 250 }, cutout: '62%',
  plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: any) => `${c.label}: ${isMoney ? money(Number(c.raw)) : num(Number(c.raw))}` } } },
});

export const doughnutData = (labels: string[], values: number[]): ChartConfiguration<'doughnut'>['data'] => ({
  labels, datasets: [{ data: values, backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 0 }],
});

export const barSet = (label: string, data: number[], color = PALETTE[0], extra: Record<string, unknown> = {}) => ({
  label, data, backgroundColor: color, borderRadius: 4, maxBarThickness: 34, ...extra,
});

export const lineSet = (label: string, data: number[], color = PALETTE[0], dashed = false, fill = false) => ({
  type: 'line' as ChartType, label, data, borderColor: color, backgroundColor: fill ? 'rgba(115,25,25,0.08)' : color, borderWidth: 2,
  pointRadius: data.length > 40 ? 0 : 2, tension: 0.3, fill, ...(dashed ? { borderDash: [6, 4] } : {}),
});
