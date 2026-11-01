/**
 * DỮ LIỆU MẪU CHO DASHBOARD / BÁO CÁO — đơn hàng từ 01/01/2026 đến hiện tại.
 *
 *   npm run analytics:seed -- --dry-run              # xem trước số lượng, không ghi
 *   npm run analytics:seed                           # ghi vào MongoDB trong .env (MONGO_URI / MONGO_DATABASE)
 *   npm run analytics:seed -- --from=2026-01-01 --to=2026-11-01 --per-day=4
 *   npm run analytics:seed -- --reset                # xóa TOÀN BỘ dữ liệu do script này tạo
 *
 * Nguyên tắc an toàn:
 *  - Mọi bản ghi có NGUON_DU_LIEU = 'analytics-seed' và DU_LIEU_MAU = true → xóa sạch bằng --reset.
 *  - Mã riêng (đơn MAUyymmddNNN, khách KHMAUnnnn) → không đụng dãy mã YEN… / CUST… của đơn & khách thật.
 *  - Chỉ dùng khách mẫu (email @example.com, không mật khẩu) hoặc khách vãng lai — KHÔNG gắn đơn vào khách thật.
 *  - KHÔNG tạo đánh giá (hiển thị công khai trên web khách), KHÔNG tạo phiếu kho / giữ tồn (giữ sổ kho đúng).
 *  - Sản phẩm, giá, chủ đề (dịp tặng), phương thức thanh toán lấy từ dữ liệu đang có trong DB.
 */
import { getCollection, getMongoClient } from '../mongo.js';

const SOURCE = 'analytics-seed';
const H = 3_600_000;
const DAY = 24 * H;
const VN = 7 * H;

const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? 'true'] as [string, string]; }));
const DRY = args.has('dry-run');
const log = (...m: unknown[]) => console.log('[analytics-seed]', ...m);

/* ---------------- tiện ích ngẫu nhiên có hạt giống (chạy lại ra cùng dữ liệu) ---------------- */
let seed = Number(args.get('seed') || 20260101);
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const chance = (p: number) => rnd() < p;
const poisson = (lambda: number) => { let L = Math.exp(-lambda), k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** yyyy-mm-dd (giờ VN) → instant nửa đêm VN */
const vnMidnight = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) - VN);
const vnYmd = (d: Date) => new Date(d.getTime() + VN).toISOString().slice(0, 10);
const vnParts = (d: Date) => { const x = new Date(d.getTime() + VN); return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), h: x.getUTCHours(), min: x.getUTCMinutes(), dow: x.getUTCDay() }; };

/* ---------------- mùa vụ hoa: hệ số đơn theo ngày + chủ đề được ưu tiên ---------------- */
const SPECIAL: { md: string; mult: number; topic: string[] }[] = [
  { md: '02-13', mult: 3, topic: ['yeu', 'tinh'] }, { md: '02-14', mult: 6, topic: ['yeu', 'tinh'] },
  { md: '03-07', mult: 3, topic: ['me', 'phu nu', 'yeu'] }, { md: '03-08', mult: 5, topic: ['me', 'phu nu', 'yeu'] },
  { md: '04-30', mult: 1.5, topic: [] }, { md: '05-01', mult: 1.5, topic: [] },
  { md: '05-10', mult: 2.5, topic: ['me'] }, // Ngày của Mẹ 2026 (CN thứ 2 tháng 5)
  { md: '06-01', mult: 1.8, topic: ['sinh nhat'] },
  { md: '10-19', mult: 3, topic: ['me', 'phu nu', 'yeu'] }, { md: '10-20', mult: 5, topic: ['me', 'phu nu', 'yeu'] },
  { md: '11-19', mult: 2.5, topic: ['thay', 'co', 'tri an'] }, { md: '11-20', mult: 4, topic: ['thay', 'co', 'tri an'] },
  { md: '12-24', mult: 2.5, topic: ['giang sinh', 'yeu'] }, { md: '12-25', mult: 2, topic: ['giang sinh', 'yeu'] },
];
// Tết Bính Ngọ 17/02/2026: nghỉ Tết vắng đơn, sau Tết nhiều khai trương
const seasonOf = (ymd: string): { mult: number; topic: string[] } => {
  const md = ymd.slice(5);
  const sp = SPECIAL.find((s) => s.md === md);
  if (sp) return sp;
  if (ymd >= '2026-02-15' && ymd <= '2026-02-20') return { mult: 0.3, topic: [] };
  if (ymd >= '2026-02-21' && ymd <= '2026-03-05') return { mult: 1.6, topic: ['khai truong'] };
  if (ymd >= '2026-02-08' && ymd <= '2026-02-14') return { mult: 1.8, topic: ['tet', 'yeu'] };
  return { mult: 1, topic: [] };
};

const FIRST = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương'];
const MID = ['Thị', 'Văn', 'Minh', 'Ngọc', 'Gia', 'Thu', 'Hoàng', 'Bảo', 'Khánh', 'Thanh', 'Quốc', 'Mỹ', 'Đức', 'Phương'];
const LAST = ['Anh', 'Linh', 'Trang', 'Huy', 'Nam', 'Vy', 'Ngọc', 'Phúc', 'Hân', 'Khoa', 'Thảo', 'Duyên', 'Long', 'Quân', 'My', 'Tú', 'Hà', 'Châu'];
const STREETS = ['Nguyễn Huệ, Q.1', 'Lê Văn Sỹ, Q.3', 'Phan Xích Long, Phú Nhuận', 'Điện Biên Phủ, Bình Thạnh', 'Nguyễn Thị Thập, Q.7', 'Cách Mạng Tháng 8, Q.10', 'Quang Trung, Gò Vấp', 'Võ Văn Ngân, Thủ Đức', 'Hai Bà Trưng, Q.1', 'Trần Hưng Đạo, Q.5'];
const CANCEL_REASONS = ['Khách đổi ý', 'Khách đặt nhầm mẫu', 'Hết hoa theo mẫu, khách không đồng ý thay thế', 'Không liên hệ được người nhận', 'Khách đặt lại đơn khác', 'Sai địa chỉ giao'];
const REFUND_REASONS = ['Hoa bị dập khi nhận', 'Giao trễ so với hẹn', 'Màu hoa khác ảnh mẫu', 'Thiếu thiệp / phụ kiện'];
const SLOTS = ['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];
const name = () => `${pick(FIRST)} ${pick(MID)} ${pick(LAST)}`;
const phone = () => `09${Math.floor(10_000_000 + rnd() * 89_999_999)}`;

const reset = async () => {
  const out: Record<string, number> = {};
  for (const c of ['DON_HANG', 'DON_HANG_CHI_TIET', 'THANH_TOAN', 'KHACH_HANG']) {
    const col = await getCollection<any>(c);
    out[c] = DRY ? await col.countDocuments({ NGUON_DU_LIEU: SOURCE }) : (await col.deleteMany({ NGUON_DU_LIEU: SOURCE })).deletedCount;
  }
  // thông báo Admin sinh từ đơn mẫu (khóa sự kiện chứa mã MAU…)
  const noti = await getCollection<any>('THONG_BAO_ADMIN');
  out.THONG_BAO_ADMIN = DRY ? await noti.countDocuments({ DOI_TUONG_ID: /^MAU/ }) : (await noti.deleteMany({ DOI_TUONG_ID: /^MAU/ })).deletedCount;
  log(DRY ? 'Sẽ xóa:' : 'Đã xóa:', out);
};

const run = async () => {
  if (args.has('reset')) return reset();

  const todayYmd = vnYmd(new Date());
  const from = String(args.get('from') || '2026-01-01');
  const to = String(args.get('to') || todayYmd);
  const perDay = Number(args.get('per-day') || 3);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error('--from / --to phải dạng YYYY-MM-DD và from ≤ to');

  const orders = await getCollection<any>('DON_HANG');
  const existing = await orders.countDocuments({ NGUON_DU_LIEU: SOURCE });
  if (existing && !args.has('append')) {
    throw new Error(`Đã có ${existing} đơn mẫu từ lần chạy trước. Chạy "--reset" trước (hoặc thêm --append để ghi thêm).`);
  }

  /* ---------- dữ liệu nền có sẵn trong DB ---------- */
  const products = (await (await getCollection<any>('SAN_PHAM')).find({}).project({ SAN_PHAM_ID: 1, TEN_SAN_PHAM: 1, GIA: 1, GIA_KHUYEN_MAI: 1, CHU_DE_ID: 1, KIEU_DANG: 1, TRANG_THAI: 1, DA_XOA: 1 }).toArray())
    .filter((p: any) => !p.DA_XOA && Number(p.GIA_KHUYEN_MAI || p.GIA) > 0 && !/ngung|^an$|^da an$|^tam an|het ban/.test(norm(p.TRANG_THAI).trim()));
  if (!products.length) throw new Error('Không tìm thấy sản phẩm có giá trong SAN_PHAM.');
  const topics = await (await getCollection<any>('CHU_DE')).find({}).toArray().catch(() => [] as any[]);
  const topicName = new Map(topics.map((t: any) => [String(t.CHU_DE_ID), norm(t.TEN_CHU_DE)]));
  const methods = [...new Set([
    ...(await orders.distinct('PHUONG_THUC_THANH_TOAN').catch(() => [])),
  ].map((m) => String(m || '').trim()).filter(Boolean))];
  const payMethods = methods.length ? methods : ['Chuyển khoản', 'MoMo', 'VNPay', 'Thanh toán khi nhận hàng (COD)'];
  const isCod = (m: string) => /cod|khi nhan|tien mat/.test(norm(m));
  // Sản phẩm phổ biến hơn được chọn nhiều hơn (trọng số cố định theo hạt giống)
  const weight = new Map(products.map((p: any) => [p.SAN_PHAM_ID, 0.3 + rnd() * 1.7]));
  const pickProduct = (topicKeys: string[]) => {
    const pool = topicKeys.length && chance(0.65)
      ? products.filter((p: any) => topicKeys.some((k) => (topicName.get(String(p.CHU_DE_ID)) || '').includes(k)))
      : products;
    const list = pool.length ? pool : products;
    const total = list.reduce((s: number, p: any) => s + (weight.get(p.SAN_PHAM_ID) || 1), 0);
    let r = rnd() * total;
    for (const p of list) { r -= weight.get(p.SAN_PHAM_ID) || 1; if (r <= 0) return p; }
    return list[list.length - 1];
  };
  log(`Nền: ${products.length} sản phẩm, ${topics.length} chủ đề, ${payMethods.length} phương thức thanh toán (${payMethods.join(' / ')})`);

  /* ---------- sinh dữ liệu ---------- */
  const now = Date.now();
  const customers: any[] = [];
  const orderDocs: any[] = [];
  const detailDocs: any[] = [];
  const paymentDocs: any[] = [];
  let custSeq = 0;
  const newCustomer = (at: Date) => {
    custSeq++;
    const id = `KHMAU${pad(custSeq, 4)}`;
    const c = {
      _id: id, KHACH_HANG_ID: id, TEN: name(), EMAIL: `khach.mau${pad(custSeq, 4)}@example.com`, SDT: phone(), MAT_KHAU: null, DOB: null, GIOI_TINH: pick(['Nữ', 'Nam', 'Nữ']),
      NGAY_DANG_KY: new Date(at.getTime() - Math.floor(rnd() * 3) * DAY - rnd() * 6 * H), LOAI_THANH_VIEN: 'Thành viên', DIEM_TICH_LUY: 0, AVATAR: null,
      TRANG_THAI: 'Hoạt động', DA_XOA: false, DU_LIEU_MAU: true, NGUON_DU_LIEU: SOURCE,
    };
    customers.push(c);
    return c;
  };

  for (let day = vnMidnight(from).getTime(); day <= vnMidnight(to).getTime(); day += DAY) {
    const ymd = vnYmd(new Date(day));
    const season = seasonOf(ymd);
    const dow = vnParts(new Date(day)).dow;
    // tăng trưởng nhẹ theo tháng (shop mới chạy web) + cuối tuần đông hơn
    const growth = 0.75 + 0.5 * ((day - vnMidnight(from).getTime()) / Math.max(DAY, vnMidnight(to).getTime() - vnMidnight(from).getTime()));
    const n = poisson(perDay * growth * season.mult * (dow === 0 || dow === 6 ? 1.3 : 1));
    for (let i = 0; i < n; i++) {
      const created = new Date(day + (7 + rnd() * 15) * H);
      if (created.getTime() > now - 20 * 60_000) continue;
      const id = `MAU${ymd.slice(2).replace(/-/g, '')}${pad(i + 1, 3)}`;

      // khách: 35% vãng lai, còn lại khách mẫu (45% quay lại nếu đã có)
      let customer: any = null;
      if (!chance(0.35)) customer = customers.length > 5 && chance(0.45) ? pick(customers.filter((c) => c.NGAY_DANG_KY < created)) || newCustomer(created) : newCustomer(created);

      // dòng hàng
      const lines = new Map<string, { p: any; qty: number }>();
      const nLines = chance(0.72) ? 1 : chance(0.75) ? 2 : 3;
      for (let k = 0; k < nLines; k++) {
        const p = pickProduct(season.topic);
        const cur = lines.get(p.SAN_PHAM_ID);
        lines.set(p.SAN_PHAM_ID, { p, qty: (cur?.qty || 0) + (chance(0.85) ? 1 : 2) });
      }
      const items = [...lines.values()].map(({ p, qty }) => ({ id: p.SAN_PHAM_ID, qty, price: Number(p.GIA_KHUYEN_MAI || p.GIA) }));
      const subtotal = items.reduce((s, x) => s + x.qty * x.price, 0);
      const shipping = pick([0, 0, 25_000, 30_000, 30_000, 40_000]);
      const discount = chance(0.18) ? Math.min(Math.round(subtotal * pick([0.05, 0.1])), 100_000) || 20_000 : 0;
      const total = subtotal + shipping - discount;
      const method = pick(payMethods);
      const cod = isCod(method);
      const deposit = cod ? Math.round(total * 0.3 / 1000) * 1000 : 0;

      // giờ giao: cùng ngày hoặc 1–3 ngày sau
      const offsetDays = chance(0.45) ? 0 : chance(0.6) ? 1 : 1 + Math.floor(rnd() * 3);
      const deliveryDay = vnYmd(new Date(created.getTime() + offsetDays * DAY));
      let slot = pick(SLOTS);
      let deliveryStart = new Date(vnMidnight(deliveryDay).getTime() + Number(slot.slice(0, 2)) * H);
      if (deliveryStart.getTime() < created.getTime() + 2 * H) { deliveryStart = new Date(created.getTime() + (3 + rnd() * 3) * H); slot = `${pad(vnParts(deliveryStart).h)}:00`; deliveryStart = new Date(vnMidnight(vnYmd(deliveryStart)).getTime() + Number(slot.slice(0, 2)) * H); }
      const deliveryEnd = new Date(deliveryStart.getTime() + H);

      // trạng thái theo thời điểm giao so với hiện tại
      const r = rnd();
      let status = 'Hoàn thành';
      let doneAt: Date | null = new Date(deliveryEnd.getTime() + (chance(0.88) ? -rnd() * 50 : rnd() * 90) * 60_000);
      let cancel: { at: Date; reason: string } | null = null;
      let refund: { at: Date; reason: string } | null = null;
      if (r < 0.055) { status = 'Đã hủy'; doneAt = null; cancel = { at: new Date(created.getTime() + rnd() * 5 * H), reason: pick(CANCEL_REASONS) }; }
      else if (r < 0.085) { status = 'Thanh toán thất bại'; doneAt = null; }
      else if (r < 0.105 && deliveryEnd.getTime() < now - 2 * DAY) { status = 'Đã hoàn tiền'; refund = { at: new Date(deliveryEnd.getTime() + rnd() * 20 * H), reason: pick(REFUND_REASONS) }; doneAt = null; }
      if (status === 'Hoàn thành' && doneAt!.getTime() > now) {
        // đơn chưa tới giờ giao → đang trong quy trình
        const left = deliveryStart.getTime() - now;
        status = left < 2 * H ? pick(['Đang giao', 'Chờ vận chuyển']) : left < 24 * H ? 'Đang chuẩn bị hàng' : pick(['Chờ xử lý', 'Đang chuẩn bị hàng']);
        doneAt = null;
      }

      orderDocs.push({
        _id: id, DON_HANG_ID: id, KIEM_TRA_TON_KHO: false, MA_PHIEN_THANH_TOAN: null,
        TEN_NGUOI_DAT: customer?.TEN || name(), SDT_NGUOI_DAT: customer?.SDT || phone(), EMAIL_NGUOI_DAT: customer?.EMAIL || '',
        KHACH_HANG_ID: customer?.KHACH_HANG_ID || null, NGAY_TAO: created, TRANG_THAI: status,
        TAM_TINH: subtotal, PHI_VAN_CHUYEN: shipping, TIEN_COC: deposit, TONG_TIEN: total, PHUONG_THUC_THANH_TOAN: method, VAT: 0,
        NGAY_MUON_GIAO: new Date(`${deliveryDay}T00:00:00.000Z`), KHUNG_GIO_MUON_GIAO: slot,
        LOI_NHAN_THIEP: '', GHI_CHU: '', AN_THONG_TIN: false, YEU_CAU_VAT: false, GUI_ANH_QUA_ZALO: chance(0.4),
        TEN_NGUOI_NHAN: name(), SDT_NGUOI_NHAN: phone(), DIA_CHI_GIAO_HANG: `${Math.floor(1 + rnd() * 300)} ${pick(STREETS)}, TP.HCM`,
        DA_CHINH_SUA_GIAO_HANG: false, LY_DO_HUY: cancel?.reason || null, NGAY_HUY: cancel?.at || null,
        LY_DO_HOAN_TIEN_TRA_HANG: refund?.reason || null, NGAY_YEU_CAU_HOAN_TIEN_TRA_HANG: refund?.at || null,
        DIEM_THUONG_SU_DUNG: null, DA_TRU_DIEM_THUONG: false, LY_DO_TU_CHOI: null,
        NGAY_HOAN_THANH: doneAt, NGAY_CAP_NHAT: doneAt || cancel?.at || refund?.at || created,
        DA_XUAT_NVL: false, DU_LIEU_MAU: true, NGUON_DU_LIEU: SOURCE,
      });
      items.forEach((x) => detailDocs.push({ _id: { DON_HANG_ID: id, SAN_PHAM_ID: x.id }, DON_HANG_ID: id, SAN_PHAM_ID: x.id, SO_LUONG: x.qty, GIA: x.price, DU_LIEU_MAU: true, NGUON_DU_LIEU: SOURCE }));

      // giao dịch thanh toán
      const pay = (no: number, amount: number, at: Date, st: string) => paymentDocs.push({
        _id: `TT${id}-${no}`, THANH_TOAN_ID: `TT${id}-${no}`, DON_HANG_ID: id, CONG_THANH_TOAN: method, MA_GIAO_DICH: `GD${id}-${no}`,
        SO_TIEN: amount, TRANG_THAI_THANH_TOAN: st, NGAY_THANH_TOAN: at, DU_LIEU_MAU: true, NGUON_DU_LIEU: SOURCE,
      });
      const paidAt = new Date(created.getTime() + (2 + rnd() * 20) * 60_000);
      if (status === 'Thanh toán thất bại') pay(1, cod ? deposit : total, paidAt, 'Thất bại');
      else if (status === 'Đã hủy') { if (!cod && chance(0.3)) pay(1, total, paidAt, 'Thất bại'); }
      else if (cod) {
        pay(1, deposit, paidAt, 'Thành công');
        if (status === 'Hoàn thành' || status === 'Đã hoàn tiền') pay(2, total - deposit, doneAt || deliveryEnd, 'Thành công');
      } else pay(1, total, paidAt, 'Thành công');
    }
  }

  // điểm tích lũy cho khách mẫu (1% doanh thu đơn hoàn thành)
  const points = new Map<string, number>();
  orderDocs.filter((o) => o.TRANG_THAI === 'Hoàn thành' && o.KHACH_HANG_ID).forEach((o) => points.set(o.KHACH_HANG_ID, (points.get(o.KHACH_HANG_ID) || 0) + Math.floor((o.TONG_TIEN - o.PHI_VAN_CHUYEN) / 100_000)));
  customers.forEach((c) => (c.DIEM_TICH_LUY = points.get(c.KHACH_HANG_ID) || 0));

  const byStatus = orderDocs.reduce((m, o) => ((m[o.TRANG_THAI] = (m[o.TRANG_THAI] || 0) + 1), m), {} as Record<string, number>);
  const revenue = orderDocs.filter((o) => o.TRANG_THAI === 'Hoàn thành').reduce((s, o) => s + o.TONG_TIEN - o.PHI_VAN_CHUYEN, 0);
  log(`Khoảng ${from} → ${to}: ${orderDocs.length} đơn, ${detailDocs.length} dòng hàng, ${paymentDocs.length} giao dịch, ${customers.length} khách mẫu`);
  log('Theo trạng thái:', byStatus);
  log(`Doanh thu thuần (đơn hoàn thành): ${revenue.toLocaleString('vi-VN')}đ`);
  if (DRY) { log('--dry-run: không ghi gì.'); return; }

  const write = async (name: string, docs: any[]) => {
    const col = await getCollection<any>(name);
    for (let i = 0; i < docs.length; i += 1000) await col.insertMany(docs.slice(i, i + 1000), { ordered: false });
    log(`Đã ghi ${docs.length} → ${name}`);
  };
  await write('KHACH_HANG', customers);
  await write('DON_HANG', orderDocs);
  await write('DON_HANG_CHI_TIET', detailDocs);
  await write('THANH_TOAN', paymentDocs);
  log('Xong. Khởi động lại server (hoặc bấm Tải lại trên Dashboard) để xem số mới. Gỡ bỏ: npm run analytics:seed -- --reset');
};

run()
  .catch((e) => { console.error('[analytics-seed] Lỗi:', e?.message || e); process.exitCode = 1; })
  .finally(async () => { try { (await getMongoClient()).close(); } catch { /* bỏ qua */ } });
