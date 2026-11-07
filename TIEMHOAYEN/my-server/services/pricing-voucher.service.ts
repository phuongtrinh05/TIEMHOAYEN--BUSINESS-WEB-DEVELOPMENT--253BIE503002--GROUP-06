import type { ClientSession } from 'mongodb';
import { createHash } from 'node:crypto';
import { getCollection } from '../mongo.js';
import { InventoryError } from './inventory/helpers.js';
import { checkProductAvailability } from './inventory/availability.service.js';
import { getDesign, isDesignProduct } from './design3d.service.js';

export type VoucherIdentity = { customerId?: string | null; verifiedGuestPhone?: string | null };
export type QuoteItem = { id: string; quantity: number; lineKey?: string; variantId?: string | null; designId?: string | null; configuration?: any; displayedUnitPrice?: number };

export const normalizeVoucherCode = (value: unknown) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
let voucherStorageReady: Promise<void> | null = null;
export const ensureVoucherStorage = async () => {
  if (!voucherStorageReady) voucherStorageReady = (async () => {
    const vouchers = await getCollection<any>('VOUCHER');
    const missing = await vouchers.find({ $or: [{ MA_VOUCHER_CHUAN: { $exists: false } }, { MA_VOUCHER_CHUAN: null }] }).project({ _id: 1, MA_VOUCHER: 1 }).toArray();
    if (missing.length) await vouchers.bulkWrite(missing.map(row => ({ updateOne: { filter: { _id: row._id }, update: { $set: { MA_VOUCHER_CHUAN: normalizeVoucherCode(row.MA_VOUCHER) } } } }))); 
    try {
      await vouchers.createIndex({ MA_VOUCHER_CHUAN: 1 }, { unique: true, partialFilterExpression: { MA_VOUCHER_CHUAN: { $type: 'string' } }, name: 'uniq_voucher_code_normalized' });
    } catch (error: any) {
      // Dữ liệu cũ có thể đã chứa mã trùng (ví dụ YEN10). Không được để việc
      // xây index làm sập báo giá/giỏ hàng. Form Admin vẫn chặn tạo hoặc sửa
      // trùng mã; dữ liệu cũ sẽ được rà soát riêng thay vì tự ý xóa voucher.
      if (error?.code !== 11000) throw error;
      console.warn('[voucher] Chưa thể tạo unique index vì dữ liệu cũ có mã trùng.');
    }
  })().catch(error => {
    voucherStorageReady = null;
    throw error;
  });
  return voucherStorageReady;
};
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const date = (value: unknown) => value ? new Date(String(value)) : null;
const truthy = (value: unknown) => value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
const list = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : String(value || '').split(',').map(v => v.trim()).filter(Boolean);
const identityKey = (identity: VoucherIdentity) => identity.customerId
  ? `member:${identity.customerId}`
  : identity.verifiedGuestPhone
    ? `guest:${createHash('sha256').update(identity.verifiedGuestPhone.replace(/\D/g, '')).digest('hex')}`
    : null;

const statusAt = (row: any, now = new Date()) => {
  const start = date(row.NGAY_BAT_DAU);
  const end = date(row.NGAY_KET_THUC);
  if (Object.prototype.hasOwnProperty.call(row, 'DA_DUYET') && row.DA_DUYET !== true) return 'Chưa duyệt';
  const paused = /tạm dừng|tam dung|paused/i.test(String(row.TRANG_THAI || '')) || row.KICH_HOAT === false;
  if (paused) return 'Tạm dừng';
  if (start && now < start) return 'Chưa bắt đầu';
  if (end && now > end) return 'Đã kết thúc';
  const limit = number(row.GIOI_HAN_TONG ?? row.TONG_LUOT);
  if (limit > 0 && number(row.LUOT_DA_DUNG) >= limit) return 'Hết lượt';
  return 'Đang diễn ra';
};

const findVoucher = async (voucherRef: any, session?: ClientSession) => {
  if (!voucherRef?.id && !voucherRef?.code) return null;
  const id = String(voucherRef.id || '').trim();
  const code = normalizeVoucherCode(voucherRef.code);
  const query: any = { $or: [] };
  if (id) query.$or.push({ VOUCHER_ID: id });
  if (code) query.$or.push({ MA_VOUCHER_CHUAN: code }, { MA_VOUCHER: { $regex: `^${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
  return (await getCollection<any>('VOUCHER')).findOne(query, { session });
};

async function validateVoucher(voucher: any, identity: VoucherIdentity, eligibleOrderCount: number, session?: ClientSession) {
  if (!voucher) throw new InventoryError(400, 'Voucher không tồn tại.');
  if (statusAt(voucher) !== 'Đang diễn ra') throw new InventoryError(400, `Voucher hiện ở trạng thái ${statusAt(voucher)}.`);
  const campaign = voucher.CHIEN_DICH_ID
    ? await (await getCollection<any>('CHIEN_DICH')).findOne({ CHIEN_DICH_ID: voucher.CHIEN_DICH_ID }, { session })
    : null;
  if (campaign && statusAt(campaign) !== 'Đang diễn ra') throw new InventoryError(400, 'Chương trình của voucher chưa hoạt động.');
  if (campaign && !truthy(campaign.DA_DUYET ?? campaign.APPROVED ?? true)) throw new InventoryError(400, 'Chương trình chưa được duyệt.');
  if (voucher.KHACH_HANG_ID && voucher.KHACH_HANG_ID !== identity.customerId) throw new InventoryError(403, 'Voucher cá nhân không thuộc tài khoản này.');
  if (voucher.KHACH_HANG_ID) {
    const personalUses = await (await getCollection<any>('VOUCHER_SU_DUNG')).countDocuments({ VOUCHER_ID: voucher.VOUCHER_ID }, { session });
    if (personalUses > 0) throw new InventoryError(409, 'Voucher cá nhân đã được sử dụng.');
  }
  const audience = String(voucher.DOI_TUONG || campaign?.DOI_TUONG || 'Tất cả').toLowerCase();
  if (!identity.customerId && !audience.includes('guest') && !audience.includes('tất cả') && !audience.includes('tat ca')) throw new InventoryError(403, 'Voucher chỉ dành cho thành viên.');
  if (identity.customerId && audience.includes('guest')) throw new InventoryError(403, 'Voucher chỉ dành cho khách vãng lai.');
  const tiers = list(voucher.HANG_THANH_VIEN ?? campaign?.HANG_THANH_VIEN);
  if (tiers.length) {
    if (!identity.customerId) throw new InventoryError(403, 'Voucher này chỉ dành cho hạng thành viên được chỉ định.');
    const customer = await (await getCollection<any>('KHACH_HANG')).findOne({ KHACH_HANG_ID: identity.customerId }, { session });
    const currentTier = String(customer?.HANG_THANH_VIEN || customer?.HANG || customer?.CAP_DO || '');
    if (!tiers.includes(currentTier)) throw new InventoryError(403, 'Hạng thành viên hiện tại không đủ điều kiện voucher.');
  }
  if (truthy(voucher.DON_DAU_TIEN ?? campaign?.DON_DAU_TIEN) && eligibleOrderCount > 0) throw new InventoryError(400, 'Voucher chỉ áp dụng cho đơn đầu tiên.');
  const perUser = number(voucher.GIOI_HAN_MOI_NGUOI ?? campaign?.GIOI_HAN_MOI_NGUOI);
  const key = identityKey(identity);
  if (perUser > 0 && !key) throw new InventoryError(401, 'Voucher giới hạn theo khách yêu cầu đăng nhập hoặc Guest xác minh số điện thoại bằng OTP.');
  if (perUser > 0 && key) {
    const used = await (await getCollection<any>('VOUCHER_SU_DUNG')).countDocuments({ VOUCHER_ID: voucher.VOUCHER_ID, DINH_DANH: key }, { session });
    if (used >= perUser) throw new InventoryError(409, 'Bạn đã dùng hết lượt của voucher này.');
  }
  return { voucher, campaign, identityKey: key, perUserLimit: perUser };
}

export async function calculateCheckoutQuote(input: {
  items: QuoteItem[]; shippingFee?: number; voucher?: any; identity?: VoucherIdentity;
}, session?: ClientSession) {
  if (!Array.isArray(input.items) || !input.items.length) throw new InventoryError(400, 'Giỏ hàng chưa có sản phẩm.');
  if (Array.isArray(input.voucher)) throw new InventoryError(400, 'Mỗi đơn chỉ được áp dụng tối đa một voucher.');
  const merged = new Map<string, number>();
  const lineMetadata = new Map<string, QuoteItem>();
  for (const raw of input.items) {
    const id = String(raw.id || '');
    const qty = Number(raw.quantity);
    if (!id.startsWith('SP') || !Number.isSafeInteger(qty) || qty < 1 || qty > 1000) throw new InventoryError(400, 'Sản phẩm hoặc số lượng không hợp lệ.');
    const configurationText = JSON.stringify(raw.configuration || {});
    if (configurationText.length > 4000) throw new InventoryError(400, 'Cấu hình dòng sản phẩm vượt giới hạn cho phép.');
    const computedKey = `${id}:${createHash('sha256').update(JSON.stringify({ variantId: raw.variantId || null, designId: raw.designId || null, configuration: raw.configuration || {} })).digest('hex').slice(0, 16)}`;
    const lineKey = /^[\w:.-]{3,120}$/.test(String(raw.lineKey || '')) ? String(raw.lineKey) : computedKey;
    merged.set(lineKey, (merged.get(lineKey) || 0) + qty);
    lineMetadata.set(lineKey, { ...raw, id, lineKey });
  }
  const productIds = [...new Set([...lineMetadata.values()].map(item => item.id))];
  const catalogIds = productIds.filter(id => !isDesignProduct(id));
  const products = catalogIds.length
    ? await (await getCollection<any>('SAN_PHAM')).find({ SAN_PHAM_ID: { $in: catalogIds }, TRANG_THAI: 'Đang bán' }, { session }).toArray()
    : [];
  if (products.length !== catalogIds.length) throw new InventoryError(409, 'Có sản phẩm đã ngừng bán, bị xóa hoặc không còn hiệu lực.');
  const productMap = new Map(products.map(product => [String(product.SAN_PHAM_ID), product]));
  const images = catalogIds.length
    ? await (await getCollection<any>('HINH_ANH_SAN_PHAM')).find({ SAN_PHAM_ID: { $in: catalogIds } }, { session }).sort({ LA_ANH_CHINH: -1, THU_TU: 1 }).toArray()
    : [];
  const imageMap = new Map<string, string>();
  images.forEach(image => { if (!imageMap.has(String(image.SAN_PHAM_ID))) imageMap.set(String(image.SAN_PHAM_ID), String(image.URL || '')); });
  const items = await Promise.all([...merged.entries()].map(async ([lineKey, quantity]) => {
    const meta = lineMetadata.get(lineKey)!;
    const design = isDesignProduct(meta.id) ? await getDesign(meta.id, session) : null;
    const p = design ? null : productMap.get(meta.id);
    if (!design && !p) throw new InventoryError(409, 'Có sản phẩm đã ngừng bán, bị xóa hoặc không còn hiệu lực.');
    const regular = Math.max(0, number(design?.price ?? p?.GIA));
    const promo = number(p?.GIA_KHUYEN_MAI);
    const unitPrice = design ? regular : promo > 0 && promo < regular ? promo : regular;
    const availability = design
      ? { decision: design.requiresReview ? 'review' : 'available', reasons: design.badges }
      : await checkProductAvailability(meta.id, quantity, session || null);
    return {
      id: meta.id, lineKey, variantId: meta.variantId || null, designId: design?.designId || meta.designId || null,
      configuration: meta.configuration || {}, quantity, name: String(design?.name || p?.TEN_SAN_PHAM || ''), image: String(design?.image || imageMap.get(meta.id) || ''),
      regularPrice: regular, unitPrice, lineTotal: unitPrice * quantity, categoryId: String(p?.CHU_DE_ID || ''), availability,
      custom: Boolean(design), design,
      priceChanged: Number.isFinite(Number(meta.displayedUnitPrice)) && Number(meta.displayedUnitPrice) !== unitPrice,
    };
  }));
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const shippingFee = Math.max(0, number(input.shippingFee));
  let productDiscount = 0;
  let shippingDiscount = 0;
  let voucherResult: any = null;
  if (input.voucher?.id || input.voucher?.code) {
    await ensureVoucherStorage();
    const voucher = await findVoucher(input.voucher, session);
    const identity = input.identity || {};
    const orderCount = identity.customerId
      ? await (await getCollection<any>('DON_HANG')).countDocuments({ KHACH_HANG_ID: identity.customerId }, { session })
      : 0;
    const validated = await validateVoucher(voucher, identity, orderCount, session);
    const productScope = new Set(list(voucher.SAN_PHAM_IDS ?? voucher.PHAM_VI_SAN_PHAM));
    const categoryScope = new Set(list(voucher.DANH_MUC_IDS ?? voucher.CHU_DE_IDS ?? voucher.PHAM_VI_DANH_MUC));
    const eligible = items.filter(item => (!productScope.size || productScope.has(item.id)) && (!categoryScope.size || categoryScope.has(item.categoryId)));
    const eligibleSubtotal = eligible.reduce((sum, item) => sum + item.lineTotal, 0);
    const minimum = Math.max(0, number(voucher.DON_TOI_THIEU ?? voucher.GIA_TRI_DON_TOI_THIEU));
    if (eligibleSubtotal < minimum) throw new InventoryError(400, `Sản phẩm hợp lệ chưa đạt đơn tối thiểu ${minimum.toLocaleString('vi-VN')}đ.`);
    const type = String(voucher.LOAI_GIAM_GIA || '').toLowerCase();
    const value = Math.max(0, number(voucher.GIA_TRI_GIAM));
    const cap = Math.max(0, number(voucher.MUC_GIAM_TOI_DA ?? voucher.TRAN_GIAM));
    if (type.includes('ship') || type.includes('vận chuyển') || type.includes('van chuyen')) shippingDiscount = Math.min(shippingFee, type.includes('phần trăm') || type.includes('%') ? shippingFee * value / 100 : value);
    else if (type.includes('phần trăm') || type.includes('phan tram') || type.includes('%')) productDiscount = Math.min(eligibleSubtotal * value / 100, cap > 0 ? cap : Number.POSITIVE_INFINITY);
    else if (type.includes('tiền') || type.includes('tien') || type.includes('amount')) productDiscount = Math.min(eligibleSubtotal, value);
    else throw new InventoryError(400, 'Loại voucher chưa được hỗ trợ.');
    productDiscount = Math.round(productDiscount);
    shippingDiscount = Math.round(shippingDiscount);
    voucherResult = { ...validated, voucher, eligibleSubtotal, productDiscount, shippingDiscount };
  }
  return { items, subtotal, shippingFee, productDiscount, shippingDiscount, total: Math.max(0, subtotal + shippingFee - productDiscount - shippingDiscount), voucherResult };
}

export async function claimVoucherUsage(session: ClientSession, voucherResult: any, orderId: string) {
  if (!voucherResult?.voucher) return;
  const voucher = voucherResult.voucher;
  const usage = await getCollection<any>('VOUCHER_SU_DUNG');
  await usage.insertOne({ _id: `${voucher.VOUCHER_ID}:${orderId}`, VOUCHER_ID: voucher.VOUCHER_ID, DON_HANG_ID: orderId, DINH_DANH: voucherResult.identityKey, NGAY_SU_DUNG: new Date(), TRANG_THAI: 'Đã ghi nhận' }, { session });
  if (voucherResult.perUserLimit > 0 && voucherResult.identityKey) {
    const counters = await getCollection<any>('VOUCHER_GIOI_HAN_NGUOI_DUNG');
    const counterId = `${voucher.VOUCHER_ID}:${voucherResult.identityKey}`;
    try {
      const counter = await counters.findOneAndUpdate(
        { _id: counterId, LUOT_DA_DUNG: { $lt: voucherResult.perUserLimit } },
        { $setOnInsert: { VOUCHER_ID: voucher.VOUCHER_ID, DINH_DANH: voucherResult.identityKey }, $inc: { LUOT_DA_DUNG: 1 } },
        { session, upsert: true, returnDocument: 'after' },
      );
      if (!counter) throw new Error('limit');
    } catch {
      throw new InventoryError(409, 'Bạn vừa dùng hết lượt của voucher này.');
    }
  }
  const totalLimit = number(voucher.GIOI_HAN_TONG ?? voucher.TONG_LUOT) || (voucher.KHACH_HANG_ID ? 1 : 0);
  const filter: any = { VOUCHER_ID: voucher.VOUCHER_ID };
  if (totalLimit > 0) filter.$expr = { $lt: [{ $ifNull: ['$LUOT_DA_DUNG', 0] }, totalLimit] };
  const claimed = await (await getCollection<any>('VOUCHER')).findOneAndUpdate(filter, { $inc: { LUOT_DA_DUNG: 1 } }, { session, returnDocument: 'after' });
  if (!claimed) throw new InventoryError(409, 'Voucher vừa hết lượt sử dụng.');
}

export const derivePromotionStatus = statusAt;
