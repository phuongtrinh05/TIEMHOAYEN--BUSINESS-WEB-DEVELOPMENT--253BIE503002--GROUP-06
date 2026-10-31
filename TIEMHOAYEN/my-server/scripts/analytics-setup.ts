/**
 * Chuẩn hóa dữ liệu cho Dashboard / Báo cáo (AD02–AD07, AD60) — chạy được nhiều lần.
 *   npm run analytics:migrate -- --dry-run   # chỉ báo cáo
 *   npm run analytics:migrate                # ghi NGAY_HOAN_THANH (ước tính) cho đơn Hoàn thành cũ, NGAY_HUY cho đơn hủy cũ
 *   npm run analytics:check                  # in KPI 30 ngày + kết quả đối chiếu đơn–tiền–kho
 * Ngày ước tính được gắn cờ NGAY_HOAN_THANH_UOC_TINH = true để báo cáo ghi chú "ước tính".
 */
import { getCollection } from '../mongo.js';
import { mapOrder } from '../services/analytics/dataset.js';
import { getDashboardOverview } from '../services/analytics/dashboard.service.js';
import { getReconciliation } from '../services/analytics/reports.service.js';
import { ensureNotificationIndexes, syncAdminNotifications } from '../services/analytics/notifications.service.js';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const log = (...a: unknown[]) => console.log('[analytics-setup]', ...a);

const migrate = async () => {
  const col = await getCollection<any>('DON_HANG');
  const orders = await col.find({}).toArray();
  let done = 0;
  let cancelled = 0;
  for (const o of orders) {
    const row = mapOrder(o);
    if (row.status === 'Hoàn thành' && !o.NGAY_HOAN_THANH) {
      done++;
      if (!DRY) await col.updateOne({ _id: o._id }, { $set: { NGAY_HOAN_THANH: row.completedAt, NGAY_HOAN_THANH_UOC_TINH: true } });
    }
    if (row.status === 'Đã hủy' && !o.NGAY_HUY) {
      cancelled++;
      if (!DRY) await col.updateOne({ _id: o._id }, { $set: { NGAY_HUY: o.NGAY_CAP_NHAT || o.NGAY_TAO || null, NGAY_HUY_UOC_TINH: true } });
    }
  }
  log(`Đơn Hoàn thành thiếu ngày hoàn thành: ${done} · Đơn hủy thiếu ngày hủy: ${cancelled}`);
  if (!DRY) { await ensureNotificationIndexes(); await syncAdminNotifications(true); }
  log(DRY ? 'DRY RUN — không ghi gì.' : 'Xong.');
};

const check = async () => {
  const o = await getDashboardOverview({ preset: '30d' });
  log(`Kỳ ${o.range.label} (so với ${o.range.previous.label})`);
  o.kpis.forEach((k: any) => log(`  ${k.code} ${k.label}: ${k.value ?? '—'} ${k.unit} (kỳ trước ${k.previous ?? '—'}, Δ ${k.change ?? '—'})`));
  const rec = await getReconciliation();
  log(`Đối chiếu: ${rec.totals.issues} nhóm lệch, ${rec.totals.rows} dòng`);
  rec.issues.filter((i: any) => i.count).forEach((i: any) => log(`  [${i.severity}] ${i.title}: ${i.count}`));
};

(async () => {
  try {
    if (args.has('--migrate')) await migrate();
    if (args.has('--check')) await check();
    if (!args.has('--migrate') && !args.has('--check')) log('Chọn --migrate [--dry-run] hoặc --check');
  } catch (e) { console.error('[analytics-setup] LỖI:', e); process.exit(1); }
  process.exit(0);
})();
