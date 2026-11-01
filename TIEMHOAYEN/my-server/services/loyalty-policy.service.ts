import { getCollection } from '../mongo.js';

/**
 * Loyalty is intentionally disabled until the unresolved business decisions are approved.
 * These collections/indexes provide an auditable, concurrency-safe foundation without
 * inventing earning, expiry, refund, stacking or tier policies.
 */
export const LOYALTY_POLICY_STATUS = Object.freeze({
  enabled: false,
  reason: 'LOYALTY_POLICY_PENDING_APPROVAL',
  earningRate: null,
  redemptionRate: null,
  earningBase: null,
  earningMoment: null,
  expiryRule: null,
  refundRule: null,
  voucherStackingRule: null,
  tierWindowMonths: null,
});

export async function ensureLoyaltyIndexes() {
  const [accounts, ledger] = await Promise.all([
    getCollection<any>('TAI_KHOAN_DIEM'),
    getCollection<any>('LICH_SU_DIEM'),
  ]);

  await Promise.all([
    accounts.createIndex({ KHACH_HANG_ID: 1 }, { unique: true, name: 'uniq_loyalty_account_customer' }),
    ledger.createIndex({ KHACH_HANG_ID: 1, NGAY_TAO: -1 }, { name: 'loyalty_history_customer_date' }),
    ledger.createIndex(
      { NGUON_LOAI: 1, NGUON_ID: 1, LOAI_BUT_TOAN: 1 },
      { unique: true, name: 'uniq_loyalty_source_entry' },
    ),
  ]);
}
