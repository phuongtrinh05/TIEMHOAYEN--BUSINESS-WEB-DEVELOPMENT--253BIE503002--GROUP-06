import { Router, type Request, type Response, type NextFunction } from 'express';
import { getCollection } from '../mongo.js';
import { hasPermission } from '../services/role-permission.service.js';
import { InventoryError } from '../services/inventory/helpers.js';
import { lookupAccess } from '../services/order-access.service.js';
import * as m from '../services/marketing.service.js';

const router = Router();
const col = (n: string) => getCollection<any>(n);
const handle = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response) => void fn(req, res).catch(e => res.status(e instanceof InventoryError ? e.status : 500).json({ message: e instanceof InventoryError ? e.message : 'Chưa xử lý được yêu cầu Marketing.' }));
const fail = (message: string, status = 400): never => { throw new InventoryError(status, message); };
router.use('/admin', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employee = await (await col('NHAN_VIEN')).findOne({ NHAN_VIEN_ID: String(req.headers['x-admin-id'] || '') });
    const action = req.method === 'GET' ? 'view' : req.method === 'POST' && ['/templates', '/configs'].includes(req.path) ? 'create' : 'update';
    if (!employee || employee.DA_XOA || /khóa|ngừng|nghỉ|inactive/i.test(employee.TRANG_THAI || '') || !hasPermission(employee.VAI_TRO, 'promotions', action)) fail('Bạn không có quyền thao tác Marketing.', 403);
    res.locals.employee = employee; res.setHeader('Cache-Control', 'no-store'); next();
  } catch (e: any) { res.status(e instanceof InventoryError ? e.status : 500).json({ message: e instanceof InventoryError ? e.message : 'Không kiểm tra được quyền.' }); }
});
router.get('/admin/options', handle(async (_req, res) => {
  const [vouchers, campaigns, products, customers, ranks] = await Promise.all([
    (await col('VOUCHER')).find({ DA_DUNG: { $ne: true } }, { projection: { _id: 0, VOUCHER_ID: 1, MA_VOUCHER: 1, KHACH_HANG_ID: 1, CHIEN_DICH_ID: 1, NGAY_KET_THUC: 1 } }).limit(1000).toArray(),
    (await col('CHIEN_DICH')).find({}, { projection: { _id: 0, CHIEN_DICH_ID: 1, TEN_CHIEN_DICH: 1 } }).limit(500).toArray(),
    (await col('SAN_PHAM')).find({}, { projection: { _id: 0, SAN_PHAM_ID: 1, TEN_SAN_PHAM: 1 } }).limit(2000).toArray(),
    (await col('KHACH_HANG')).find({ DA_XOA: { $ne: true } }, { projection: { _id: 0, KHACH_HANG_ID: 1, TEN: 1 } }).limit(1000).toArray(),
    (await col('KHACH_HANG')).distinct('LOAI_THANH_VIEN'),
  ]);
  res.json({ vouchers, campaigns, products, customers, ranks, purposes: m.purposes, variables: m.variables, emailReady: m.emailReady(), workerEnabled: process.env.MARKETING_BACKGROUND_JOBS !== 'false' });
}));
router.get('/admin/templates', handle(async (_req, res) => res.json(await (await col('MAU_TIN_NHAN')).find({}).sort({ NGAY_CAP_NHAT: -1 }).limit(500).toArray())));
async function saveTemplate(req: Request, res: Response) {
  const value = m.normalizeTemplate(req.body), now = new Date(), employee = res.locals.employee.NHAN_VIEN_ID;
  const collection = await col('MAU_TIN_NHAN');
  if (req.params.id) {
    const row = await collection.findOneAndUpdate({ MAU_ID: req.params.id, PHIEN_BAN: req.body.PHIEN_BAN }, { $set: { ...value, NGAY_CAP_NHAT: now, NHAN_VIEN_CAP_NHAT_ID: employee }, $inc: { PHIEN_BAN: 1 } }, { returnDocument: 'after' });
    if (!row) fail('Mẫu đã thay đổi. Tải lại trước khi sửa.', 409);
    res.json(row);
  } else {
    const row = { ...value, MAU_ID: m.id('MAU'), PHIEN_BAN: 1, NGAY_TAO: now, NGAY_CAP_NHAT: now, NHAN_VIEN_TAO_ID: employee };
    await collection.insertOne(row); res.status(201).json(row);
  }
}
router.post('/admin/templates', handle(saveTemplate)); router.put('/admin/templates/:id', handle(saveTemplate));
router.get('/admin/configs', handle(async (_req, res) => res.json(await (await col('CAU_HINH_GUI_TU_DONG')).find({}).sort({ NGAY_TAO: -1 }).limit(500).toArray())));
async function saveConfig(req: Request, res: Response) {
  const value = m.normalizeConfig(req.body), template = await (await col('MAU_TIN_NHAN')).findOne({ MAU_ID: value.MAU_ID });
  await m.checkLinks(value, template);
  if (value.LOAI_THANH_VIEN && !await (await col('KHACH_HANG')).findOne({ LOAI_THANH_VIEN: value.LOAI_THANH_VIEN })) fail('Hạng thành viên không tồn tại.');
  const collection = await col('CAU_HINH_GUI_TU_DONG'), now = new Date();
  const payload = { ...value, TRANG_THAI: 'Tạm dừng', XEM_TRUOC_HASH: null, GUI_THU_HASH: null, NGAY_CAP_NHAT: now };
  if (req.params.id) {
    const row = await collection.findOneAndUpdate({ CAU_HINH_ID: req.params.id, PHIEN_BAN: req.body.PHIEN_BAN }, { $set: payload, $inc: { PHIEN_BAN: 1 } }, { returnDocument: 'after' });
    if (!row) fail('Cấu hình đã thay đổi. Tải lại trước khi sửa.', 409);
    res.json(row);
  } else {
    const row = { ...payload, CAU_HINH_ID: m.id('CFG'), PHIEN_BAN: 1, BAT_DAU_AP_DUNG: now, NGAY_TAO: now, NHAN_VIEN_TAO_ID: res.locals.employee.NHAN_VIEN_ID };
    await collection.insertOne(row); res.status(201).json(row);
  }
}
router.post('/admin/configs', handle(saveConfig)); router.put('/admin/configs/:id', handle(saveConfig));
async function loadConfig(id: string) {
  const c = await (await col('CAU_HINH_GUI_TU_DONG')).findOne({ CAU_HINH_ID: id });
  if (!c) fail('Không tìm thấy cấu hình.', 404);
  const t = await (await col('MAU_TIN_NHAN')).findOne({ MAU_ID: c.MAU_ID });
  await m.checkLinks(c, t);
  return { c, t, fingerprint: m.revision([c.CAU_HINH_ID, c.PHIEN_BAN, t.MAU_ID, t.PHIEN_BAN]) };
}
router.post('/admin/configs/:id/preview', handle(async (req, res) => {
  const { c, t, fingerprint } = await loadConfig(String(req.params.id));
  const customer = req.body.customerId ? await (await col('KHACH_HANG')).findOne({ KHACH_HANG_ID: req.body.customerId }) : null;
  const { v, p } = await m.checkLinks(c, t);
  const values = { ten_khach: customer?.TEN || 'Khách hàng mẫu', ma_voucher: v?.MA_VOUCHER, ten_san_pham: p?.TEN_SAN_PHAM, ma_don: c.SU_KIEN_KICH_HOAT === 'order' ? 'ĐƠN-MINH-HỌA' : null };
  const preview = { title: m.render(t.TIEU_DE || t.TEN_MAU, values), text: m.render(t.NOI_DUNG, values), channel: t.KENH_GUI, sample: true };
  await (await col('CAU_HINH_GUI_TU_DONG')).updateOne({ CAU_HINH_ID: c.CAU_HINH_ID, PHIEN_BAN: c.PHIEN_BAN }, { $set: { XEM_TRUOC_HASH: fingerprint, BAN_XEM_TRUOC: preview } });
  res.json(preview);
}));
router.post('/admin/configs/:id/test', handle(async (req, res) => {
  const { c, t, fingerprint } = await loadConfig(String(req.params.id));
  if (c.XEM_TRUOC_HASH !== fingerprint || !c.BAN_XEM_TRUOC) fail('Xem trước phiên bản mới nhất trước khi gửi thử.');
  const staff = res.locals.employee, logs = await col('LICH_SU_GUI');
  if (await logs.findOne({ LA_GUI_THU: true, NHAN_VIEN_ID: staff.NHAN_VIEN_ID, NGAY_TAO: { $gt: new Date(Date.now() - 60000) } })) fail('Chờ 60 giây trước lần gửi thử tiếp theo.', 429);
  const key = m.id('TEST');
  // Test recipient is the authenticated employee, never a customer supplied by the browser.
  const row: any = { GUI_ID: key, KHOA_CHONG_TRUNG: key, CAU_HINH_ID: c.CAU_HINH_ID, NHAN_VIEN_ID: staff.NHAN_VIEN_ID, LA_GUI_THU: true,
    KENH_GUI: t.KENH_GUI, DIA_CHI_NHAN: t.KENH_GUI === 'email' ? staff.EMAIL : 'Khu vực gửi thử của nhân viên', TIEU_DE_THUC_TE: c.BAN_XEM_TRUOC.title, NOI_DUNG_THUC_TE: c.BAN_XEM_TRUOC.text, NGAY_TAO: new Date(), TRANG_THAI: 'Đang gửi' };
  if (t.KENH_GUI === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staff.EMAIL || '')) fail('Tài khoản nhân viên chưa có email nhận thử hợp lệ.');
  await logs.insertOne(row);
  try {
    const provider = t.KENH_GUI === 'email' ? await m.sendEmail(staff.EMAIL, '[Gửi thử] ' + row.TIEU_DE_THUC_TE, row.NOI_DUNG_THUC_TE, key) : null;
    await logs.updateOne({ GUI_ID: key }, { $set: { TRANG_THAI: 'Đã gửi', THOI_DIEM_GUI: new Date(), MA_GUI_NHA_CUNG_CAP: provider } });
  } catch (e) { await logs.updateOne({ GUI_ID: key }, { $set: { TRANG_THAI: 'Thất bại', LOI_GUI: 'Gửi thử chưa thành công.' } }); throw e; }
  await (await col('CAU_HINH_GUI_TU_DONG')).updateOne({ CAU_HINH_ID: c.CAU_HINH_ID, PHIEN_BAN: c.PHIEN_BAN }, { $set: { GUI_THU_HASH: fingerprint } });
  res.json({ ...c.BAN_XEM_TRUOC, message: t.KENH_GUI === 'email' ? 'Đã gửi thử tới email của bạn.' : 'Tin thử hiển thị bên dưới; không gửi đến khách hàng.' });
}));
router.post('/admin/configs/:id/status', handle(async (req, res) => {
  if (req.body.TRANG_THAI !== 'Đang bật') {
    const r = await (await col('CAU_HINH_GUI_TU_DONG')).updateOne({ CAU_HINH_ID: req.params.id, PHIEN_BAN: req.body.PHIEN_BAN }, { $set: { TRANG_THAI: 'Tạm dừng' } });
    if (!r.matchedCount) fail('Cấu hình đã thay đổi.', 409);
    return res.json({ message: 'Đã tạm dừng.' });
  }
  const { c, t, fingerprint } = await loadConfig(String(req.params.id));
  if (t.TRANG_THAI !== 'Đang bật' || c.XEM_TRUOC_HASH !== fingerprint || c.GUI_THU_HASH !== fingerprint) fail('Bật mẫu, xem trước và gửi thử phiên bản hiện tại trước khi bật tự động.');
  if (t.KENH_GUI === 'email' && !m.emailReady()) fail('Email chưa được cấu hình.', 503);
  if (c.SU_KIEN_KICH_HOAT === 'schedule' && new Date(c.THOI_DIEM_GUI).getTime() <= Date.now()) fail('Lịch đã qua. Chỉnh thời điểm gửi và kiểm tra lại.');
  const r = await (await col('CAU_HINH_GUI_TU_DONG')).updateOne({ CAU_HINH_ID: c.CAU_HINH_ID, PHIEN_BAN: req.body.PHIEN_BAN, XEM_TRUOC_HASH: fingerprint, GUI_THU_HASH: fingerprint }, { $set: { TRANG_THAI: 'Đang bật' } });
  if (!r.matchedCount) fail('Cấu hình đã thay đổi.', 409);
  res.json({ message: 'Đã bật tự động.' });
}));
router.get('/admin/history', handle(async (req, res) => {
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const query: any = {};
  if (req.query.configId) query.CAU_HINH_ID = String(req.query.configId);
  if (req.query.status) query.TRANG_THAI = String(req.query.status);
  const logs = await col('LICH_SU_GUI');
  res.json({ items: await logs.find(query, { projection: { _id: 0, EMAIL_BODY: 0, LEASE: 0 } }).sort({ NGAY_TAO: -1 }).skip((page - 1) * 20).limit(20).toArray(), total: await logs.countDocuments(query), page });
}));
async function member(req: Request) {
  const access = await lookupAccess(req.headers['x-order-access']);
  if (access.authType !== 'member') fail('Đăng nhập để thay đổi tùy chọn nhận tin.', 401);
  return access.customerId;
}
router.get('/preferences', handle(async (req, res) => {
  const c = await (await col('KHACH_HANG')).findOne({ KHACH_HANG_ID: await member(req) });
  res.setHeader('Cache-Control', 'no-store'); res.json({ allowed: c?.DONG_Y_NHAN_QUANG_CAO === true, answered: typeof c?.DONG_Y_NHAN_QUANG_CAO === 'boolean' });
}));
router.put('/preferences', handle(async (req, res) => {
  if (typeof req.body.allowed !== 'boolean') fail('Tùy chọn nhận tin không hợp lệ.');
  await m.consent(await member(req), req.body.allowed); res.json({ allowed: req.body.allowed });
}));
router.get('/unsubscribe', (req, res) => {
  const token = String(req.query.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).send('Liên kết không hợp lệ.');
  res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Ngừng nhận tin · Hoa Yên</title><body style="font-family:Arial;background:#fff8f5;color:#781b20;padding:8vw"><h2>Ngừng nhận quảng cáo từ Hoa Yên?</h2><p>Bạn vẫn nhận thông tin cần thiết về đơn hàng.</p><form method="post"><input type="hidden" name="token" value="${token}"><button style="background:#781b20;color:white;padding:12px 20px;border:0;border-radius:8px">Xác nhận ngừng nhận</button></form></body></html>`);
});
// The server's urlencoded middleware parses this confirmation form.
router.post('/unsubscribe', handle(async (req, res) => { await m.unsubscribe(String(req.body.token || '')); res.type('html').send('<meta charset="utf-8"><p>Đã ngừng nhận quảng cáo từ Hoa Yên. Bạn có thể bật lại trong tài khoản.</p>'); }));
export default router;
