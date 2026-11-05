const numericId = (row: any, code: string) => Number.isFinite(Number(row.id)) ? Number(row.id) : Number(code.match(/\d+$/)?.[0] || 0);

/** Accept the MongoDB API fields and the earlier camelCase contract. */
export function mapPromotionCampaign(row: any) {
  const code = String(row.CHIEN_DICH_ID ?? row.code ?? '');
  return { id: numericId(row, code), code, name: String(row.TEN_CHIEN_DICH ?? row.name ?? ''),
    description: String(row.MO_TA ?? row.description ?? ''), startDate: row.NGAY_BAT_DAU ?? row.startDate ?? '',
    endDate: row.NGAY_KET_THUC ?? row.endDate ?? '', status: String(row.TRANG_THAI ?? row.status ?? ''),
    active: row.KICH_HOAT ?? row.active ?? false,
    approved: row.DA_DUYET ?? row.approved ?? false,
    audience: String(row.DOI_TUONG ?? row.audience ?? 'Tất cả'),
    membershipTiers: Array.isArray(row.HANG_THANH_VIEN ?? row.membershipTiers)
      ? [...(row.HANG_THANH_VIEN ?? row.membershipTiers)]
      : [],
    totalLimit: Number(row.GIOI_HAN_TONG ?? row.totalLimit ?? 0),
    perUserLimit: Number(row.GIOI_HAN_MOI_NGUOI ?? row.perUserLimit ?? 0),
    firstOrderOnly: row.DON_DAU_TIEN ?? row.firstOrderOnly ?? false,
    selected: false };
}
export function mapPromotionVoucher(row: any) {
  const code = String(row.VOUCHER_ID ?? row.code ?? '');
  const used = row.DA_DUNG ?? row.used;
  return { id: numericId(row, code), code, voucherCode: String(row.MA_VOUCHER ?? row.voucherCode ?? ''),
    campaignCode: String(row.CHIEN_DICH_ID ?? row.campaignCode ?? ''), customerId: String(row.KHACH_HANG_ID ?? row.customerId ?? ''),
    customerName: String(row.TEN_KHACH_HANG ?? row.customerName ?? ''), discountType: String(row.LOAI_GIAM_GIA ?? row.discountType ?? ''),
    discountValue: Number(row.GIA_TRI_GIAM ?? row.discountValue ?? 0), startDate: row.NGAY_BAT_DAU ?? row.startDate ?? '',
    endDate: row.NGAY_KET_THUC ?? row.endDate ?? '',
    maxDiscount: Number(row.MUC_GIAM_TOI_DA ?? row.GIAM_TOI_DA ?? row.maxDiscount ?? 0),
    minimumOrder: Number(row.DON_TOI_THIEU ?? row.GIA_TRI_DON_TOI_THIEU ?? row.DON_HANG_TOI_THIEU ?? row.minimumOrder ?? 0),
    productIds: Array.isArray(row.SAN_PHAM_IDS ?? row.productIds) ? [...(row.SAN_PHAM_IDS ?? row.productIds)] : [],
    categoryIds: Array.isArray(row.DANH_MUC_IDS ?? row.categoryIds) ? [...(row.DANH_MUC_IDS ?? row.categoryIds)] : [],
    audience: String(row.DOI_TUONG ?? row.audience ?? 'Tất cả'),
    membershipTiers: Array.isArray(row.HANG_THANH_VIEN ?? row.membershipTiers)
      ? [...(row.HANG_THANH_VIEN ?? row.membershipTiers)]
      : [],
    totalLimit: Number(row.GIOI_HAN_TONG ?? row.totalLimit ?? 0),
    perUserLimit: Number(row.GIOI_HAN_MOI_NGUOI ?? row.perUserLimit ?? 0),
    firstOrderOnly: row.DON_DAU_TIEN ?? row.firstOrderOnly ?? false,
    active: row.KICH_HOAT ?? row.active ?? false,
    status: String(row.TRANG_THAI ?? row.status ?? ''),
    usageCount: Number(row.LUOT_DA_DUNG ?? row.usageCount ?? 0),
    used: used === true || used === 1, selected: false };
}
