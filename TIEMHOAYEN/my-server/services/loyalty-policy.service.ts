import type { ClientSession } from 'mongodb';
import { getCollection } from '../mongo.js';
import { InventoryError } from './inventory/helpers.js';
import { normalizeTier } from './voucher-policy.service.js';

export const LOYALTY_POLICY_STATUS = Object.freeze({
  enabled: true,
  earningRate: { paidProductValue: 10_000, points: 1 },
  redemptionRate: { points: 1, value: 500 },
  earningBase: 'Giá trị sản phẩm thực trả sau giảm giá, không gồm phí giao hàng',
  earningMoment: 'Hoàn thành đơn',
  expiryRule: '12 tháng từ lần cộng điểm hoàn thành gần nhất',
  refundRule: 'Hoàn toàn bộ điểm đã dùng khi đơn bị hủy',
  afterSalesRule: 'Hoàn tiền hậu mãi (trả hàng/hoàn tiền) không trả lại điểm thưởng và voucher đã dùng; chỉ hoàn tiền mặt đã thanh toán',
  voucherStackingRule: 'Được dùng đồng thời voucher và điểm',
  tierImpact: 'Điểm sử dụng không làm giảm chi tiêu xét hạng',
});

const points = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));
const addMonths = (date: Date, months: number) => {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
};

export async function ensureLoyaltyIndexes() {
  const ledger = await getCollection<any>('LICH_SU_DIEM');
  await Promise.all([
    ledger.createIndex({ KHACH_HANG_ID: 1, NGAY_TAO: -1 }, { name: 'loyalty_history_customer_date' }),
    ledger.createIndex(
      { NGUON_LOAI: 1, NGUON_ID: 1, LOAI_BUT_TOAN: 1 },
      { unique: true, name: 'uniq_loyalty_source_entry' },
    ),
  ]);
}

export async function expireCustomerPoints(customerId: string, session?: ClientSession) {
  const customers = await getCollection<any>('KHACH_HANG');
  const customer = await customers.findOne({ KHACH_HANG_ID: customerId }, { session });
  const balance = points(customer?.DIEM_TICH_LUY);
  const expiresAt = customer?.DIEM_HET_HAN ? new Date(customer.DIEM_HET_HAN) : null;
  if (balance && !expiresAt) {
    const migratedExpiry = addMonths(new Date(), 12);
    await customers.updateOne(
      { KHACH_HANG_ID: customerId, $or: [{ DIEM_HET_HAN: { $exists: false } }, { DIEM_HET_HAN: null }] },
      { $set: { DIEM_HET_HAN: migratedExpiry, NGAY_CAP_NHAT_DIEM: new Date() } },
      { session },
    );
    return balance;
  }
  if (!balance || !expiresAt || expiresAt.getTime() > Date.now()) return balance;
  const result = await customers.updateOne(
    { KHACH_HANG_ID: customerId, DIEM_TICH_LUY: balance, DIEM_HET_HAN: { $lte: new Date() } },
    { $set: { DIEM_TICH_LUY: 0, NGAY_CAP_NHAT_DIEM: new Date() } }, { session },
  );
  if (result.modifiedCount) await (await getCollection<any>('LICH_SU_DIEM')).updateOne(
    { NGUON_LOAI: 'HET_HAN', NGUON_ID: `${customerId}:${expiresAt.toISOString()}`, LOAI_BUT_TOAN: 'HET_HAN' },
    { $setOnInsert: { KHACH_HANG_ID: customerId, SO_DIEM: -balance, NGAY_TAO: new Date(), SO_DU_SAU: 0 } },
    { upsert: true, session },
  );
  return 0;
}

export async function redeemOrderPoints(session: ClientSession, customerId: string, orderId: string, amount: number) {
  const use = points(amount);
  if (!use) return null;
  await expireCustomerPoints(customerId, session);
  const customers = await getCollection<any>('KHACH_HANG');
  const before = await customers.findOne({ KHACH_HANG_ID: customerId }, { session });
  const result = await customers.findOneAndUpdate(
    { KHACH_HANG_ID: customerId, DIEM_TICH_LUY: use },
    { $inc: { DIEM_TICH_LUY: -use }, $set: { NGAY_CAP_NHAT_DIEM: new Date() } },
    { session, returnDocument: 'after' },
  );
  if (!result) throw new InventoryError(409, 'Số dư điểm vừa thay đổi. Hệ thống chỉ cho dùng toàn bộ số điểm hiện có; vui lòng tải lại trang.');
  await (await getCollection<any>('LICH_SU_DIEM')).insertOne({
    NGUON_LOAI: 'DON_HANG', NGUON_ID: orderId, LOAI_BUT_TOAN: 'SU_DUNG', KHACH_HANG_ID: customerId,
    SO_DIEM: -use, SO_DU_SAU: points(result.DIEM_TICH_LUY), NGAY_TAO: new Date(),
  }, { session });
  return before?.DIEM_HET_HAN || null;
}

export async function restoreOrderPoints(session: ClientSession, order: any) {
  const used = points(order?.DIEM_THUONG_SU_DUNG);
  const customerId = String(order?.KHACH_HANG_ID || '');
  if (!used || !customerId || order?.DA_TRU_DIEM_THUONG !== true || order?.DA_HOAN_DIEM_THUONG === true) return;
  const ledger = await getCollection<any>('LICH_SU_DIEM');
  try {
    await ledger.insertOne({ NGUON_LOAI: 'DON_HANG', NGUON_ID: order.DON_HANG_ID, LOAI_BUT_TOAN: 'HOAN', KHACH_HANG_ID: customerId, SO_DIEM: used, NGAY_TAO: new Date() }, { session });
  } catch (error: any) {
    if (error?.code === 11000) return;
    throw error;
  }
  const restored = await (await getCollection<any>('KHACH_HANG')).findOneAndUpdate(
    { KHACH_HANG_ID: customerId },
    { $inc: { DIEM_TICH_LUY: used }, $set: { NGAY_CAP_NHAT_DIEM: new Date(), ...(order.DIEM_HET_HAN_TRUOC_KHI_DUNG ? { DIEM_HET_HAN: order.DIEM_HET_HAN_TRUOC_KHI_DUNG } : {}) } },
    { session, returnDocument: 'after' },
  );
  await ledger.updateOne({ NGUON_LOAI: 'DON_HANG', NGUON_ID: order.DON_HANG_ID, LOAI_BUT_TOAN: 'HOAN' }, { $set: { SO_DU_SAU: points(restored?.DIEM_TICH_LUY) } }, { session });
  await (await getCollection<any>('DON_HANG')).updateOne({ DON_HANG_ID: order.DON_HANG_ID }, { $set: { DA_HOAN_DIEM_THUONG: true } }, { session });
}

export async function awardCompletedOrderPoints(session: ClientSession, order: any) {
  const customerId = String(order?.KHACH_HANG_ID || '');
  if (!customerId) return;
  const snapshot = order?.TINH_TIEN_SNAPSHOT || {};
  const paidProductValue = Math.max(0, Number(order.TAM_TINH || snapshot.subtotal || 0)
    - Number(snapshot.productVoucherDiscount || order.GIAM_GIA_SAN_PHAM || 0)
    - Number(snapshot.loyaltyDiscount || 0));
  const earned = Math.floor(paidProductValue / 10_000);
  if (!earned) return;
  const ledger = await getCollection<any>('LICH_SU_DIEM');
  // Lỗi trùng khóa trong transaction sẽ hủy cả transaction, nên phải kiểm tra trước khi ghi.
  if (await ledger.findOne({ NGUON_LOAI: 'DON_HANG', NGUON_ID: order.DON_HANG_ID, LOAI_BUT_TOAN: 'CONG' }, { session })) return;
  try {
    await ledger.insertOne({ NGUON_LOAI: 'DON_HANG', NGUON_ID: order.DON_HANG_ID, LOAI_BUT_TOAN: 'CONG', KHACH_HANG_ID: customerId, SO_DIEM: earned, CO_SO_TINH: paidProductValue, NGAY_TAO: new Date() }, { session });
  } catch (error: any) {
    if (error?.code === 11000) return;
    throw error;
  }
  const expiresAt = addMonths(new Date(), 12);
  const updated = await (await getCollection<any>('KHACH_HANG')).findOneAndUpdate(
    { KHACH_HANG_ID: customerId },
    { $inc: { DIEM_TICH_LUY: earned }, $set: { DIEM_HET_HAN: expiresAt, NGAY_CAP_NHAT_DIEM: new Date() } },
    { session, returnDocument: 'after' },
  );
  await ledger.updateOne({ NGUON_LOAI: 'DON_HANG', NGUON_ID: order.DON_HANG_ID, LOAI_BUT_TOAN: 'CONG' }, { $set: { SO_DU_SAU: points(updated?.DIEM_TICH_LUY), HET_HAN_LUC: expiresAt } }, { session });
  await (await getCollection<any>('DON_HANG')).updateOne({ DON_HANG_ID: order.DON_HANG_ID }, { $set: { DA_CONG_DIEM_THUONG: true, DIEM_THUONG_DA_CONG: earned } }, { session });
}

const TIER_RANK: Record<string, number> = { dong: 0, bac: 1, vang: 2, 'kim cuong': 3 };
export const tierForSpending = (total: number) => (total >= 6_000_000 ? 'Kim cương' : total >= 3_000_000 ? 'Vàng' : total >= 1_000_000 ? 'Bạc' : 'Đồng');

/** Tính lại tổng tiền hàng đơn hoàn thành; chỉ nâng hạng, không hạ hạng và không đổi nhãn hạng lạ. */
export async function refreshCustomerTier(session: ClientSession, customerId: string) {
  const customers = await getCollection<any>('KHACH_HANG');
  const customer = await customers.findOne({ KHACH_HANG_ID: customerId }, { session });
  if (!customer) return;
  const [row] = await (await getCollection<any>('DON_HANG')).aggregate([
    { $match: { KHACH_HANG_ID: customerId, TRANG_THAI: 'Hoàn thành' } },
    { $group: { _id: null, total: { $sum: { $ifNull: ['$TAM_TINH', 0] } } } },
  ], { session }).toArray();
  const total = Number(row?.total || 0), next = tierForSpending(total);
  const currentRank = TIER_RANK[normalizeTier(customer.LOAI_THANH_VIEN || 'Đồng')], nextRank = TIER_RANK[normalizeTier(next)];
  await customers.updateOne({ KHACH_HANG_ID: customerId }, { $set: {
    TONG_TAM_TINH_HOAN_THANH: total,
    ...(currentRank !== undefined && nextRank > currentRank ? { LOAI_THANH_VIEN: next } : {}),
  } }, { session });
}

async function orderHasRefund(session: ClientSession, order: any) {
  if (String(order?.LY_DO_HOAN_TIEN_TRA_HANG || '').trim()) return true;
  const orderId = order.DON_HANG_ID;
  if (await (await getCollection<any>('THANH_TOAN')).findOne({ DON_HANG_ID: orderId, LOAI_GIAO_DICH: 'HOAN_TIEN' }, { session, projection: { _id: 1 } })) return true;
  const cases = await (await getCollection<any>('HOAN_TIEN')).find({ DON_HANG_ID: orderId }, { session }).toArray();
  return cases.some((row: any) => !/từ chối|hủy/i.test(String(row.status ?? row.TRANG_THAI ?? '')));
}

/** Gọi trong transaction, sau khi đơn đã chuyển sang "Hoàn thành". */
export async function settleCompletedOrder(session: ClientSession, order: any) {
  const customerId = String(order?.KHACH_HANG_ID || '');
  if (!customerId) return;
  if (!(await orderHasRefund(session, order))) await awardCompletedOrderPoints(session, order);
  await refreshCustomerTier(session, customerId);
}
