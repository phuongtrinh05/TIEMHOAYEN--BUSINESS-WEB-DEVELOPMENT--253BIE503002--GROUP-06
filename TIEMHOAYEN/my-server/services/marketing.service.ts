import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { getCollection } from '../mongo.js';
import { InventoryError, withTransaction } from './inventory/helpers.js';
import { appsScriptMarketingReady, sendAppsScriptMarketingEmail } from './apps-script-marketing.service.js';

export const purposes = ['Quảng cáo', 'Voucher', 'Sản phẩm mới', 'Nhắc đánh giá', 'Dịp đặc biệt'];
export const channels = ['website', 'email'];
export const events = ['schedule', 'order', 'birthday', 'annual'];
export const variables = ['ten_khach', 'ma_voucher', 'ten_san_pham', 'ma_don'];
export const id = (prefix: string) => prefix + randomBytes(12).toString('hex');
const col = (name: string) => getCollection<any>(name);
const bad = (message: string, status = 400): never => { throw new InventoryError(status, message); };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const otpSecret = () => {
  const secret = process.env.APPS_SCRIPT_MARKETING_SECRET || process.env.AUTH_OTP_SECRET || '';
  if (secret.length < 32) bad('Dịch vụ xác nhận email chưa được cấu hình.', 503);
  return secret;
};
const otpHash = (customerId: string, challengeId: string, code: string) => createHmac('sha256', otpSecret())
  .update(`${customerId}|${challengeId}|${code}`).digest('hex');
export const revision = (v: any) => hash(JSON.stringify(v));
// Approval is bound to the exact config + template versions; any edit to either invalidates it.
export const approvalFingerprint = (c: any, t: any) => revision([c.CAU_HINH_ID, c.PHIEN_BAN, t.MAU_ID, t.PHIEN_BAN]);
export const isApproved = (c: any, t: any) => {
  const fingerprint = approvalFingerprint(c, t);
  return c.XEM_TRUOC_HASH === fingerprint && c.GUI_THU_HASH === fingerprint;
};
const active = (c: any) => c && !c.DA_XOA && !/khóa|ngừng|inactive/i.test(c.TRANG_THAI || '');
const voucherAvailable = (v: any, now: Date) => {
  if (!v || v.KICH_HOAT === false || v.DA_XOA) return false;
  if (v.NGAY_BAT_DAU && new Date(v.NGAY_BAT_DAU) > now) return false;
  if (v.NGAY_KET_THUC && new Date(v.NGAY_KET_THUC) < now) return false;
  const totalLimit = Number(v.GIOI_HAN_TONG || 0);
  if (totalLimit > 0 && Number(v.LUOT_DA_DUNG || 0) >= totalLimit) return false;
  if (v.DA_DUNG === true && Number(v.LUOT_DA_DUNG || 0) === 0) return false;
  return true;
};

const campaignReady = (campaign: any, now: Date) => Boolean(
  campaign
  && campaign.KICH_HOAT === true
  && campaign.DA_DUYET === true
  && !campaign.DA_XOA
  && !/ẩn|dừng|kết thúc|hủy/i.test(campaign.TRANG_THAI || '')
  && (!campaign.NGAY_BAT_DAU || new Date(campaign.NGAY_BAT_DAU) <= now)
  && (!campaign.NGAY_KET_THUC || new Date(campaign.NGAY_KET_THUC) >= now)
);

const sameVoucherFamilyQuery = (seed: any, customerId: string) => {
  if (seed.NHOM_PHAT_HANH_ID) return { NHOM_PHAT_HANH_ID: seed.NHOM_PHAT_HANH_ID, KHACH_HANG_ID: customerId };
  const baseCode = seed.MA_VOUCHER_GOC || seed.MA_VOUCHER_CHUAN || seed.MA_VOUCHER;
  return {
    KHACH_HANG_ID: customerId,
    $or: [{ MA_VOUCHER_GOC: baseCode }, { MA_VOUCHER_CHUAN: baseCode }, { MA_VOUCHER: baseCode }],
    CHIEN_DICH_ID: seed.CHIEN_DICH_ID ?? null,
    LOAI_GIAM_GIA: seed.LOAI_GIAM_GIA,
    GIA_TRI_GIAM: seed.GIA_TRI_GIAM,
  };
};

export async function resolveVoucherForCustomer(seed: any, customer: any, now = new Date()) {
  if (!seed) return null;
  if (!seed.KHACH_HANG_ID) return voucherAvailable(seed, now) ? seed : bad('Voucher không còn hiệu lực.');
  if (!customer?.KHACH_HANG_ID) return bad('Chọn khách minh họa để xác định voucher cá nhân.');
  const voucher = seed.KHACH_HANG_ID === customer.KHACH_HANG_ID
    ? seed
    : await (await col('VOUCHER')).findOne(sameVoucherFamilyQuery(seed, customer.KHACH_HANG_ID));
  if (!voucher || !voucherAvailable(voucher, now)) bad('Khách không có voucher cá nhân còn hiệu lực trong nhóm đã chọn.');
  return voucher;
}
export const emailReady = () => {
  try {
    const url = new URL(process.env.MARKETING_PUBLIC_URL || '');
    return Boolean(appsScriptMarketingReady() && ['http:', 'https:'].includes(url.protocol)
      && (process.env.NODE_ENV !== 'production' || url.protocol === 'https:'));
  } catch { return false; }
};
export function normalizeTemplate(b: any) {
  const t = { TEN_MAU: String(b.TEN_MAU || '').trim(), MUC_DICH: b.MUC_DICH, KENH_GUI: b.KENH_GUI,
    TIEU_DE: String(b.TIEU_DE || '').trim(), NOI_DUNG: String(b.NOI_DUNG || '').trim(), TRANG_THAI: b.TRANG_THAI === 'Đang bật' ? 'Đang bật' : 'Tạm dừng' };
  if (!t.TEN_MAU || t.TEN_MAU.length > 150 || !purposes.includes(t.MUC_DICH) || !channels.includes(t.KENH_GUI) || !t.NOI_DUNG || t.NOI_DUNG.length > 10000 || t.TIEU_DE.length > 200 || t.KENH_GUI === 'email' && !t.TIEU_DE) bad('Điền tên mẫu, mục đích, kênh, nội dung và tiêu đề email hợp lệ.');
  for (const text of [t.NOI_DUNG, t.TIEU_DE]) {
    for (const m of text.matchAll(/{{\s*([^{}]+?)\s*}}/g)) if (!variables.includes(m[1])) bad('Biến không hỗ trợ: ' + m[1]);
    if (text.replace(/{{\s*[^{}]+?\s*}}/g, '').includes('{{') || text.replace(/{{\s*[^{}]+?\s*}}/g, '').includes('}}')) bad('Biến phải có dạng {{ten_khach}}.');
  }
  return t;
}
export function render(text: string, data: any) {
  return text.replace(/{{\s*([^{}]+?)\s*}}/g, (_, key) => {
    if (!variables.includes(key) || !data[key]) return bad('Thiếu dữ liệu cho biến ' + key);
    return String(data[key]);
  });
}
export function normalizeConfig(b: any) {
  const date = b.THOI_DIEM_GUI ? new Date(b.THOI_DIEM_GUI) : null;
  const delay = Number(b.DO_TRE_PHUT || 0), month = Number(b.THANG || 0), day = Number(b.NGAY || 0);
  if (!String(b.TEN_CAU_HINH || '').trim() || String(b.TEN_CAU_HINH).length > 150 || !events.includes(b.SU_KIEN_KICH_HOAT) || !Number.isInteger(delay) || delay < 0 || delay > 43200) bad('Tên cấu hình, sự kiện hoặc khoảng chờ không hợp lệ.');
  if (b.SU_KIEN_KICH_HOAT === 'schedule' && (!date || !Number.isFinite(date.getTime()) || date.getTime() <= Date.now())) bad('Chọn thời điểm gửi trong tương lai.');
  if (b.SU_KIEN_KICH_HOAT === 'annual' && (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || new Date(Date.UTC(2024, month - 1, day)).getUTCMonth() !== month - 1)) bad('Ngày/tháng dịp đặc biệt không hợp lệ.');
  return { TEN_CAU_HINH: String(b.TEN_CAU_HINH).trim(), MAU_ID: String(b.MAU_ID || ''), SU_KIEN_KICH_HOAT: b.SU_KIEN_KICH_HOAT,
    LOAI_THANH_VIEN: String(b.LOAI_THANH_VIEN || ''), VOUCHER_ID: String(b.VOUCHER_ID || ''), SAN_PHAM_ID: String(b.SAN_PHAM_ID || ''), CHIEN_DICH_ID: String(b.CHIEN_DICH_ID || ''),
    THOI_DIEM_GUI: date, DO_TRE_PHUT: delay, THANG: month, NGAY: day };
}
export async function checkLinks(c: any, t: any, now = new Date()) {
  if (!t) bad('Mẫu không tồn tại.');
  if (t.MUC_DICH === 'Nhắc đánh giá' && c.SU_KIEN_KICH_HOAT !== 'order' || c.SU_KIEN_KICH_HOAT === 'order' && t.MUC_DICH !== 'Nhắc đánh giá') bad('Nhắc đánh giá phải dùng sự kiện đơn hoàn thành.');
  if (c.SU_KIEN_KICH_HOAT === 'birthday' && t.MUC_DICH !== 'Dịp đặc biệt') bad('Sinh nhật cần mẫu Dịp đặc biệt.');
  const v = c.VOUCHER_ID ? await (await col('VOUCHER')).findOne({ VOUCHER_ID: c.VOUCHER_ID }) : null;
  const p = c.SAN_PHAM_ID ? await (await col('SAN_PHAM')).findOne({ SAN_PHAM_ID: c.SAN_PHAM_ID }) : null;
  const campaignId = c.CHIEN_DICH_ID || v?.CHIEN_DICH_ID;
  const campaign = campaignId ? await (await col('CHIEN_DICH')).findOne({ CHIEN_DICH_ID: campaignId }) : null;
  const selectedPersonalGroupUnavailable = v?.KHACH_HANG_ID && (v.KICH_HOAT === false || v.DA_XOA
    || v.NGAY_BAT_DAU && new Date(v.NGAY_BAT_DAU) > now
    || v.NGAY_KET_THUC && new Date(v.NGAY_KET_THUC) < now);
  if (c.VOUCHER_ID && (!v || (v.KHACH_HANG_ID ? selectedPersonalGroupUnavailable : !voucherAvailable(v, now)))) bad('Voucher không tồn tại, chưa bật, đã hết lượt hoặc hết hạn.');
  if (c.SAN_PHAM_ID && (!p || /ẩn|ngừng|hết kinh doanh/i.test(p.TRANG_THAI || ''))) bad('Sản phẩm không còn hiển thị.');
  if (c.CHIEN_DICH_ID && !campaign || campaignId && (!campaign || /ẩn|dừng|kết thúc|hủy/i.test(campaign.TRANG_THAI || '') || campaign.NGAY_KET_THUC && new Date(campaign.NGAY_KET_THUC) < now)) bad('Chiến dịch không còn hiệu lực.');
  if (v?.CHIEN_DICH_ID && c.CHIEN_DICH_ID && v.CHIEN_DICH_ID !== c.CHIEN_DICH_ID) bad('Voucher không thuộc chiến dịch đã chọn.');
  const tokens = (t.TIEU_DE || '') + t.NOI_DUNG;
  if ((t.MUC_DICH === 'Voucher' || tokens.includes('ma_voucher')) && !v) bad('Chọn voucher cho mẫu này.');
  if ((t.MUC_DICH === 'Sản phẩm mới' || tokens.includes('ten_san_pham')) && !p) bad('Chọn sản phẩm cho mẫu này.');
  if (tokens.includes('ma_don') && c.SU_KIEN_KICH_HOAT !== 'order') bad('Biến mã đơn chỉ dùng cho nhắc đánh giá.');
  return { v, p, campaign };
}
export async function context(c: any, t: any, customer: any, orderId?: string, now = new Date()) {
  if (!active(customer)) bad('Khách hàng không còn hoạt động.');
  if (c.LOAI_THANH_VIEN && c.LOAI_THANH_VIEN !== customer.LOAI_THANH_VIEN) bad('Khách không thuộc nhóm nhận.');
  if (t.MUC_DICH !== 'Nhắc đánh giá' && customer.DONG_Y_NHAN_QUANG_CAO !== true) bad('Khách chưa đồng ý nhận quảng cáo.');
  if (t.KENH_GUI === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.EMAIL || '')) bad('Khách chưa có email hợp lệ.');
  const { v: selectedVoucher, p, campaign } = await checkLinks(c, t, now);
  const v = await resolveVoucherForCustomer(selectedVoucher, customer, now);
  if (campaign && !campaignReady(campaign, now)) bad('Chiến dịch chưa được kích hoạt, phê duyệt hoặc chưa trong thời gian áp dụng.');
  if (t.MUC_DICH === 'Voucher' && t.KENH_GUI === 'email' && v?.KICH_HOAT !== true) bad('Voucher chưa được kích hoạt.');
  let order: any = null;
  if (c.SU_KIEN_KICH_HOAT === 'order') {
    order = await (await col('DON_HANG')).findOne({ DON_HANG_ID: orderId, KHACH_HANG_ID: customer.KHACH_HANG_ID, TRANG_THAI: 'Hoàn thành' });
    if (!order || !order.NGAY_HOAN_THANH || order.NGAY_HOAN_THANH_UOC_TINH || order.LY_DO_HOAN_TIEN_TRA_HANG || new Date(order.NGAY_HOAN_THANH) < new Date(c.BAT_DAU_AP_DUNG) || new Date(order.NGAY_HOAN_THANH).getTime() + c.DO_TRE_PHUT * 60000 > now.getTime()) bad('Đơn chưa đủ điều kiện nhắc đánh giá.');
    if (await (await col('DANH_GIA')).findOne({ DON_HANG_ID: orderId })) bad('Đơn đã được đánh giá.');
  }
  const values = { ten_khach: customer.TEN, ma_voucher: v?.MA_VOUCHER, ten_san_pham: p?.TEN_SAN_PHAM, ma_don: orderId };
  return { title: render(t.TIEU_DE || t.TEN_MAU, values), text: render(t.NOI_DUNG, values), address: t.KENH_GUI === 'email' ? customer.EMAIL : customer.KHACH_HANG_ID,
    voucherId: v?.VOUCHER_ID || null, voucherCode: v?.MA_VOUCHER || null,
    campaignId: campaign?.CHIEN_DICH_ID || null,
    link: c.SU_KIEN_KICH_HOAT === 'order' ? '/order-review?orderId=' + encodeURIComponent(orderId || '') : p ? '/product-detail/' + encodeURIComponent(p.SAN_PHAM_ID) : '/account?section=voucher' };
}
export async function ensureMarketingIndexes() {
  await (await col('MAU_TIN_NHAN')).createIndex({ MAU_ID: 1 }, { unique: true });
  await (await col('CAU_HINH_GUI_TU_DONG')).createIndex({ CAU_HINH_ID: 1 }, { unique: true });
  await (await col('LICH_SU_GUI')).createIndex({ KHOA_CHONG_TRUNG: 1 }, { unique: true });
  await (await col('LICH_SU_GUI')).createIndex({ TRANG_THAI: 1, LAN_THU_TIEP_THEO: 1 });
  await (await col('VOUCHER')).createIndex({ NHOM_PHAT_HANH_ID: 1, KHACH_HANG_ID: 1, KICH_HOAT: 1 });
  await (await col('XAC_THUC_EMAIL_MARKETING')).createIndex({ HET_HAN: 1 }, { expireAfterSeconds: 0 });
  await (await col('XAC_THUC_EMAIL_MARKETING')).createIndex({ KHACH_HANG_ID: 1, NGAY_TAO: -1 });
}

const cleanText = (value: unknown, fallback: string) => String(value || fallback).replace(/[{}]/g, '').replace(/\s+/g, ' ').trim().slice(0, 500);
const scheduledAt = (value: unknown, now: Date) => {
  const date = value ? new Date(String(value)) : now;
  return Number.isFinite(date.getTime()) && date > now ? date : new Date(now.getTime() - 1000);
};

// Auto-drafted announcements always start paused: staff must preview, test-send and enable them
// like any other config. Re-registering with unchanged source data keeps an existing approval.
async function draftAutomaticAnnouncement(templateId: string, configId: string, template: any, config: any, sourceStart: unknown, now: Date) {
  const configs = await col('CAU_HINH_GUI_TU_DONG');
  const source = revision([template, { ...config, THOI_DIEM_GUI: undefined }, sourceStart ? String(sourceStart) : null]);
  if ((await configs.findOne({ CAU_HINH_ID: configId }, { projection: { NGUON_HASH: 1 } }))?.NGUON_HASH === source) return;
  await (await col('MAU_TIN_NHAN')).updateOne({ MAU_ID: templateId }, { $set: { MAU_ID: templateId, ...template, TRANG_THAI: 'Đang bật', NGAY_CAP_NHAT: now }, $inc: { PHIEN_BAN: 1 }, $setOnInsert: { _id: templateId, NGAY_TAO: now } }, { upsert: true });
  await configs.updateOne({ CAU_HINH_ID: configId }, { $set: { CAU_HINH_ID: configId, MAU_ID: templateId, ...config, TRANG_THAI: 'Tạm dừng', XEM_TRUOC_HASH: null, GUI_THU_HASH: null, BAN_XEM_TRUOC: null, NGUON_HASH: source, NGAY_CAP_NHAT: now }, $inc: { PHIEN_BAN: 1 }, $setOnInsert: { _id: configId, NGAY_TAO: now, BAT_DAU_AP_DUNG: now } }, { upsert: true });
}

export async function registerAutomaticCampaignAnnouncement(campaign: any, now = new Date()) {
  if (!campaign?.CHIEN_DICH_ID) return;
  const sourceId = String(campaign.CHIEN_DICH_ID), templateId = `AUTO_CAMPAIGN_${sourceId}`, configId = `AUTO_CAMPAIGN_CFG_${sourceId}`;
  const name = cleanText(campaign.TEN_CHIEN_DICH, 'Chiến dịch mới');
  await draftAutomaticAnnouncement(templateId, configId,
    { TEN_MAU: `Tự động - ${name}`.slice(0, 150), MUC_DICH: 'Quảng cáo', KENH_GUI: 'email', TIEU_DE: `Tiệm Hoa Yên - ${name}`.slice(0, 200), NOI_DUNG: `Xin chào {{ten_khach}}, Tiệm Hoa Yên vừa có chiến dịch mới: ${name}. ${cleanText(campaign.MO_TA, 'Mời bạn ghé xem những ưu đãi mới nhất.')}` },
    { TEN_CAU_HINH: `Gửi chiến dịch ${name}`.slice(0, 150), SU_KIEN_KICH_HOAT: 'schedule', CHIEN_DICH_ID: sourceId, THOI_DIEM_GUI: scheduledAt(campaign.NGAY_BAT_DAU, now), DO_TRE_PHUT: 0 },
    campaign.NGAY_BAT_DAU, now);
}

export async function registerAutomaticVoucherAnnouncement(vouchers: any[], now = new Date()) {
  const seed = vouchers?.[0];
  if (!seed?.VOUCHER_ID) return;
  const group = String(seed.NHOM_PHAT_HANH_ID || seed.VOUCHER_ID).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  const templateId = `AUTO_VOUCHER_${group}`, configId = `AUTO_VOUCHER_CFG_${group}`;
  await draftAutomaticAnnouncement(templateId, configId,
    { TEN_MAU: `Tự động - Voucher ${seed.MA_VOUCHER_GOC || seed.MA_VOUCHER}`.slice(0, 150), MUC_DICH: 'Voucher', KENH_GUI: 'email', TIEU_DE: 'Tiệm Hoa Yên - Voucher mới dành cho {{ten_khach}}', NOI_DUNG: 'Xin chào {{ten_khach}}, bạn có voucher mới: {{ma_voucher}}. Hãy đăng nhập và mở mục Voucher của tôi để xem chi tiết.' },
    { TEN_CAU_HINH: `Gửi voucher ${seed.MA_VOUCHER_GOC || seed.MA_VOUCHER}`.slice(0, 150), SU_KIEN_KICH_HOAT: 'schedule', VOUCHER_ID: seed.VOUCHER_ID, CHIEN_DICH_ID: seed.CHIEN_DICH_ID || '', THOI_DIEM_GUI: scheduledAt(seed.NGAY_BAT_DAU, now), DO_TRE_PHUT: 0 },
    seed.NGAY_BAT_DAU, now);
}

export async function requestPreferenceEmailOtp(customerId: string, rawEmail: unknown, now = new Date()) {
  const email = String(rawEmail || '').replace(/[\s\u200B-\u200D\uFEFF]+/g, '').toLowerCase();
  if (!emailPattern.test(email) || email.length > 254) bad('Vui lòng nhập email hợp lệ để nhận thông báo ưu đãi.');
  const simulate = process.env.NODE_ENV !== 'production' && process.env.MARKETING_OTP_SIMULATE === 'true';
  if (!simulate && !appsScriptMarketingReady()) bad('Dịch vụ gửi email chưa được cấu hình.', 503);
  const customers = await col('KHACH_HANG');
  if (await customers.findOne({ KHACH_HANG_ID: { $ne: customerId }, EMAIL: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } })) bad('Email này đã được sử dụng cho tài khoản khác.', 409);
  const challenges = await col('XAC_THUC_EMAIL_MARKETING');
  const latest = await challenges.findOne({ KHACH_HANG_ID: customerId, DA_DUNG: { $ne: true } }, { sort: { NGAY_TAO: -1 } });
  if (latest?.GUI_LAI_SAU && new Date(latest.GUI_LAI_SAU) > now) bad('Vui lòng chờ một phút trước khi gửi lại mã OTP.', 429);
  await challenges.updateMany({ KHACH_HANG_ID: customerId, DA_DUNG: { $ne: true } }, { $set: { DA_DUNG: true, LY_DO: 'Mã mới được tạo' } });
  const challengeId = id('MKTOTP_'), code = String(randomInt(100000, 1000000));
  const expiresAt = new Date(now.getTime() + 10 * 60_000);
  await challenges.insertOne({ _id: challengeId, XAC_THUC_ID: challengeId, KHACH_HANG_ID: customerId, EMAIL: email, MA_HASH: otpHash(customerId, challengeId, code), SO_LAN_SAI: 0, DA_DUNG: false, NGAY_TAO: now, GUI_LAI_SAU: new Date(now.getTime() + 60_000), HET_HAN: expiresAt });
  if (simulate) {
    console.info(`[MARKETING OTP TEST] customer=${customerId} email=${email} otp=${code} expires=${expiresAt.toISOString()}`);
  } else {
    try {
      await sendAppsScriptMarketingEmail({ to: email, subject: 'Tiệm Hoa Yên - Mã xác nhận nhận ưu đãi', body: `Mã OTP của bạn là: ${code}. Mã có hiệu lực trong 10 phút. Không chia sẻ mã này với người khác.`, requestId: challengeId });
    } catch (error) {
      await challenges.updateOne({ _id: challengeId }, { $set: { DA_DUNG: true, LY_DO: 'Gửi email thất bại' } });
      throw error;
    }
  }
  const [name, domain] = email.split('@');
  return { challengeId, expiresIn: 600, resendAfter: 60, emailMasked: `${name.slice(0, 2)}${'*'.repeat(Math.max(1, name.length - 2))}@${domain}` };
}

export async function verifyPreferenceEmailOtp(customerId: string, challengeId: unknown, rawCode: unknown, now = new Date()) {
  const idValue = String(challengeId || ''), code = String(rawCode || '').trim();
  if (!/^[0-9]{6}$/.test(code)) bad('Mã OTP phải gồm 6 chữ số.');
  const challenges = await col('XAC_THUC_EMAIL_MARKETING');
  const challenge = await challenges.findOne({ _id: idValue, KHACH_HANG_ID: customerId, DA_DUNG: { $ne: true } });
  if (!challenge || new Date(challenge.HET_HAN) <= now) bad('Mã OTP đã hết hạn hoặc không còn hiệu lực.', 400);
  if (Number(challenge.SO_LAN_SAI || 0) >= 5) bad('Bạn đã nhập sai quá số lần cho phép. Vui lòng gửi mã mới.', 429);
  if (otpHash(customerId, idValue, code) !== challenge.MA_HASH) {
    await challenges.updateOne({ _id: idValue }, { $inc: { SO_LAN_SAI: 1 }, ...(Number(challenge.SO_LAN_SAI || 0) >= 4 ? { $set: { DA_DUNG: true, LY_DO: 'Nhập sai quá 5 lần' } } : {}) });
    bad('Mã OTP không đúng. Vui lòng kiểm tra lại.', 400);
  }
  const customers = await col('KHACH_HANG');
  if (await customers.findOne({ KHACH_HANG_ID: { $ne: customerId }, EMAIL: { $regex: `^${String(challenge.EMAIL).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } })) bad('Email này đã được sử dụng cho tài khoản khác.', 409);
  const result = await customers.findOneAndUpdate({ KHACH_HANG_ID: customerId }, { $set: { EMAIL: challenge.EMAIL, EMAIL_DA_XAC_MINH: true, EMAIL_DA_XAC_MINH_LUC: now, DONG_Y_NHAN_QUANG_CAO: true, THOI_DIEM_DONG_Y: now, NGAY_CAP_NHAT: now } }, { returnDocument: 'after' });
  if (!result) bad('Không tìm thấy tài khoản khách hàng.', 404);
  await challenges.updateOne({ _id: idValue }, { $set: { DA_DUNG: true, XAC_MINH_LUC: now } });
  return { allowed: true, email: challenge.EMAIL, hasEmail: true };
}
export async function enqueue(c: any, t: any, customer: any, event: string, orderId?: string, now = new Date()) {
  const payload = await context(c, t, customer, orderId, now);
  const key = hash([c.CAU_HINH_ID, customer.KHACH_HANG_ID, t.KENH_GUI, event].join('|'));
  return (await col('LICH_SU_GUI')).updateOne({ KHOA_CHONG_TRUNG: key }, { $setOnInsert: {
    GUI_ID: id('GUI'), KHOA_CHONG_TRUNG: key, CAU_HINH_ID: c.CAU_HINH_ID, PHIEN_BAN_CAU_HINH: c.PHIEN_BAN, MAU_ID: t.MAU_ID, PHIEN_BAN_MAU: t.PHIEN_BAN,
    KHACH_HANG_ID: customer.KHACH_HANG_ID, DON_HANG_ID: orderId || null, SU_KIEN_CU_THE: event, KENH_GUI: t.KENH_GUI, DIA_CHI_NHAN: payload.address,
    TIEU_DE_THUC_TE: payload.title, NOI_DUNG_THUC_TE: payload.text, DUONG_DAN: payload.link,
    VOUCHER_ID_THUC_TE: payload.voucherId, MA_VOUCHER_THUC_TE: payload.voucherCode,
    CHIEN_DICH_ID_THUC_TE: payload.campaignId,
    THOI_DIEM_DU_KIEN: now, TRANG_THAI: 'Chờ gửi', SO_LAN_THU: 0, LAN_THU_TIEP_THEO: now, NGAY_TAO: now,
  } }, { upsert: true });
}

async function personalVoucherRecipientIds(c: any, t: any, now: Date): Promise<string[] | null> {
  if (t.MUC_DICH !== 'Voucher' || t.KENH_GUI !== 'email') return null;
  const { v: seed, campaign } = await checkLinks(c, t, now);
  if (!seed) return [];
  if (!seed.KHACH_HANG_ID) return voucherAvailable(seed, now) ? null : [];
  if (seed.KICH_HOAT !== true) return [];
  if (campaign && !campaignReady(campaign, now)) return [];
  const query = seed.NHOM_PHAT_HANH_ID
    ? { NHOM_PHAT_HANH_ID: seed.NHOM_PHAT_HANH_ID }
    : { VOUCHER_ID: seed.VOUCHER_ID };
  const vouchers = await (await col('VOUCHER')).find({
    ...query,
    KHACH_HANG_ID: { $nin: [null, ''] },
    KICH_HOAT: true,
    DA_XOA: { $ne: true },
  }).limit(1000).toArray();
  return [...new Set<string>(vouchers
    .filter(voucher => voucherAvailable(voucher, now)
      && (!campaign || voucher.CHIEN_DICH_ID === campaign.CHIEN_DICH_ID))
    .map(voucher => String(voucher.KHACH_HANG_ID)))];
}

export async function scheduleMarketing(now = new Date()) {
  const vn = new Date(now.getTime() + 7 * 3600000), today = vn.toISOString().slice(0, 10);
  for await (const c of (await col('CAU_HINH_GUI_TU_DONG')).find({ TRANG_THAI: 'Đang bật' })) {
    const t = await (await col('MAU_TIN_NHAN')).findOne({ MAU_ID: c.MAU_ID, TRANG_THAI: 'Đang bật' });
    if (!t || !isApproved(c, t)) continue;
    if (c.SU_KIEN_KICH_HOAT === 'schedule' && new Date(c.THOI_DIEM_GUI) > now) continue;
    if (c.SU_KIEN_KICH_HOAT === 'annual' && (vn.getUTCMonth() + 1 !== c.THANG || vn.getUTCDate() !== c.NGAY)) continue;
    let inserted = 0;
    const orders = c.SU_KIEN_KICH_HOAT === 'order' ? (await col('DON_HANG')).find({ TRANG_THAI: 'Hoàn thành', NGAY_HOAN_THANH: { $gte: new Date(c.BAT_DAU_AP_DUNG), $lte: new Date(now.getTime() - c.DO_TRE_PHUT * 60000) }, NGAY_HOAN_THANH_UOC_TINH: { $ne: true } }) : null;
    let voucherCustomerIds: string[] | null = null;
    try { voucherCustomerIds = await personalVoucherRecipientIds(c, t, now); }
    catch (e) { if (e instanceof InventoryError) continue; throw e; }
    const customerQuery: any = c.LOAI_THANH_VIEN ? { LOAI_THANH_VIEN: c.LOAI_THANH_VIEN } : {};
    if (t.MUC_DICH !== 'Nhắc đánh giá') customerQuery.DONG_Y_NHAN_QUANG_CAO = true;
    if (voucherCustomerIds) {
      customerQuery.KHACH_HANG_ID = { $in: voucherCustomerIds };
    }
    const recipients = orders || (await col('KHACH_HANG')).find(customerQuery);
    for await (const row of recipients) {
      const customer = orders ? await (await col('KHACH_HANG')).findOne({ KHACH_HANG_ID: row.KHACH_HANG_ID }) : row;
      if (!customer) continue;
      if (c.SU_KIEN_KICH_HOAT === 'birthday') {
        const dob = customer.DOB ? new Date(customer.DOB) : null;
        if (!dob || !Number.isFinite(dob.getTime()) || dob.getUTCMonth() !== vn.getUTCMonth() || dob.getUTCDate() !== vn.getUTCDate()) continue;
      }
      const event = orders ? 'order:' + row.DON_HANG_ID : c.SU_KIEN_KICH_HOAT === 'schedule' ? 'schedule:' + new Date(c.THOI_DIEM_GUI).toISOString() : today;
      try { const r = await enqueue(c, t, customer, event, orders ? row.DON_HANG_ID : undefined, now); inserted += r.upsertedCount; } catch (e) { if (!(e instanceof InventoryError) && (e as any).code !== 11000) throw e; }
      if (inserted >= 500) break;
    }
  }
}
export async function consent(customerId: string, allowed: boolean) {
  await (await col('KHACH_HANG')).updateOne({ KHACH_HANG_ID: customerId }, { $set: { DONG_Y_NHAN_QUANG_CAO: allowed,
    ...(allowed ? { THOI_DIEM_DONG_Y: new Date() } : { THOI_DIEM_NGUNG_NHAN: new Date() }) } });
}
export async function unsubscribeToken(customerId: string) {
  const token = randomBytes(32).toString('hex');
  await (await col('KHACH_HANG')).updateOne({ KHACH_HANG_ID: customerId }, { $addToSet: { MARKETING_UNSUB_HASHES: hash(token) } });
  return token;
}
export async function unsubscribe(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) bad('Liên kết không hợp lệ.');
  const c = await (await col('KHACH_HANG')).findOne({ MARKETING_UNSUB_HASHES: hash(token) });
  if (!c) bad('Liên kết không hợp lệ.', 404);
  await consent(c.KHACH_HANG_ID, false);
}
export async function sendEmail(to: string, subject: string, text: string, key: string) {
  if (!emailReady()) bad('Email chưa được cấu hình.', 503);
  return sendAppsScriptMarketingEmail({ to, subject, body: text, requestId: key });
}
export async function deliverMarketing(now = new Date()) {
  const logs = await col('LICH_SU_GUI');
  await logs.updateMany({ TRANG_THAI: 'Đang gửi', HET_HAN_GIU: { $lt: now } }, { $set: { TRANG_THAI: 'Chờ gửi' } });
  for (let i = 0; i < 50; i++) {
    const lease = id('LEASE');
    const row = await logs.findOneAndUpdate({ TRANG_THAI: 'Chờ gửi', LAN_THU_TIEP_THEO: { $lte: now } }, { $set: { TRANG_THAI: 'Đang gửi', LEASE: lease, HET_HAN_GIU: new Date(now.getTime() + 60000) }, $inc: { SO_LAN_THU: 1 } }, { returnDocument: 'after', sort: { NGAY_TAO: 1 } });
    if (!row) break;
    const finish = (status: string, fields: any = {}) => logs.updateOne({ GUI_ID: row.GUI_ID, LEASE: lease }, { $set: { TRANG_THAI: status, ...fields }, $unset: { LEASE: '', HET_HAN_GIU: '' } });
    try {
      const c = await (await col('CAU_HINH_GUI_TU_DONG')).findOne({ CAU_HINH_ID: row.CAU_HINH_ID });
      const t = await (await col('MAU_TIN_NHAN')).findOne({ MAU_ID: row.MAU_ID });
      if (!c || !t || c.TRANG_THAI !== 'Đang bật' || t.TRANG_THAI !== 'Đang bật' || c.PHIEN_BAN !== row.PHIEN_BAN_CAU_HINH || t.PHIEN_BAN !== row.PHIEN_BAN_MAU) bad('Mẫu hoặc cấu hình đã thay đổi/tạm dừng.');
      if (['birthday', 'annual'].includes(c.SU_KIEN_KICH_HOAT) && row.SU_KIEN_CU_THE !== new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10)) bad('Đã qua ngày gửi của dịp đặc biệt.');
      const customer = await (await col('KHACH_HANG')).findOne({ KHACH_HANG_ID: row.KHACH_HANG_ID });
      const current = await context(c, t, customer, row.DON_HANG_ID, now);
      if (current.address !== row.DIA_CHI_NHAN) bad('Thông tin người nhận đã thay đổi.');
      if (current.title !== row.TIEU_DE_THUC_TE || current.text !== row.NOI_DUNG_THUC_TE) bad('Dữ liệu cá nhân hóa đã thay đổi. Cần kiểm tra lại nội dung.');
      if (String(current.voucherId || '') !== String(row.VOUCHER_ID_THUC_TE || '')
        || String(current.voucherCode || '') !== String(row.MA_VOUCHER_THUC_TE || '')
        || String(current.campaignId || '') !== String(row.CHIEN_DICH_ID_THUC_TE || '')) {
        bad('Quyền sở hữu voucher hoặc chiến dịch đã thay đổi.');
      }
      if (row.KENH_GUI === 'website') {
        await withTransaction(async session => {
          // Both notification and completion commit together; retries cannot create two notifications.
          const owned = await logs.findOne({ GUI_ID: row.GUI_ID, LEASE: lease, TRANG_THAI: 'Đang gửi' }, { session });
          if (!owned) return;
          const noticeId = 'MKT_' + row.GUI_ID;
          await (await col('THONG_BAO')).updateOne({ _id: noticeId }, { $setOnInsert: { THONG_BAO_ID: noticeId, KHACH_HANG_ID: row.KHACH_HANG_ID,
            DON_HANG_ID: row.DON_HANG_ID, LOAI_THONG_BAO: t.MUC_DICH === 'Nhắc đánh giá' ? 'review' : 'promotion', TIEU_DE: row.TIEU_DE_THUC_TE,
            NOI_DUNG: row.NOI_DUNG_THUC_TE, DUONG_DAN: row.DUONG_DAN, DA_DOC: false, NGAY_TAO: now, GUI_ID: row.GUI_ID } }, { upsert: true, session });
          await logs.updateOne({ GUI_ID: row.GUI_ID, LEASE: lease }, { $set: { TRANG_THAI: 'Đã gửi', THOI_DIEM_GUI: now, THONG_BAO_ID: noticeId, LOI_GUI: null }, $unset: { LEASE: '', HET_HAN_GIU: '' } }, { session });
        });
      } else {
        if (now.getTime() - new Date(row.NGAY_TAO).getTime() > 23 * 3600000) bad('Quá thời hạn gửi an toàn; không tự gửi lại.');
        // Store the unsubscribe URL before calling the provider so retry payloads stay identical.
        let body = row.EMAIL_BODY;
        if (!body) {
          const token = await unsubscribeToken(row.KHACH_HANG_ID);
          body = row.NOI_DUNG_THUC_TE + '\n\nNgừng nhận quảng cáo: ' + process.env.MARKETING_PUBLIC_URL?.replace(/\/$/, '') + '/api/marketing/unsubscribe?token=' + token;
          await logs.updateOne({ GUI_ID: row.GUI_ID, LEASE: lease }, { $set: { EMAIL_BODY: body } });
        }
        const providerId = await sendEmail(row.DIA_CHI_NHAN, row.TIEU_DE_THUC_TE, body, row.KHOA_CHONG_TRUNG);
        await finish('Đã gửi', { THOI_DIEM_GUI: now, MA_GUI_NHA_CUNG_CAP: providerId, KET_QUA: 'Nhà cung cấp đã tiếp nhận', LOI_GUI: null });
      }
    } catch (e: any) {
      const condition = e instanceof InventoryError && e.status !== 503;
      const retry = !condition && row.SO_LAN_THU < 4;
      await finish(condition ? 'Đã hủy' : retry ? 'Chờ gửi' : 'Thất bại', { LOI_GUI: e instanceof InventoryError ? e.message : 'Kênh gửi chưa phản hồi thành công.', LAN_THU_TIEP_THEO: new Date(now.getTime() + row.SO_LAN_THU * 5 * 60000) });
    }
  }
}
let running = false;
export function startMarketingJobs() {
  const run = async () => { if (running) return; running = true; try { await scheduleMarketing(); await deliverMarketing(); } catch (e: any) { console.error('Marketing worker:', e.name); } finally { running = false; } };
  void run();
  const timer = setInterval(() => void run(), 60000); timer.unref();
  return () => clearInterval(timer);
}
