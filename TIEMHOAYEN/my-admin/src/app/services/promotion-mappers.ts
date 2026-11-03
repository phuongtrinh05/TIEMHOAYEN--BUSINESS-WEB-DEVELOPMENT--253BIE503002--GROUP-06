const numericId = (row: any, code: string) => Number.isFinite(Number(row.id)) ? Number(row.id) : Number(code.match(/\d+$/)?.[0] || 0);

/** Accept the MongoDB API fields and the earlier camelCase contract. */
export function mapPromotionCampaign(row: any) {
  const code = String(row.CHIEN_DICH_ID ?? row.code ?? '');
  return { id: numericId(row, code), code, name: String(row.TEN_CHIEN_DICH ?? row.name ?? ''),
    description: String(row.MO_TA ?? row.description ?? ''), startDate: row.NGAY_BAT_DAU ?? row.startDate ?? '',
    endDate: row.NGAY_KET_THUC ?? row.endDate ?? '', status: String(row.TRANG_THAI ?? row.status ?? ''), selected: false };
}
export function mapPromotionVoucher(row: any) {
  const code = String(row.VOUCHER_ID ?? row.code ?? '');
  const used = row.DA_DUNG ?? row.used;
  return { id: numericId(row, code), code, voucherCode: String(row.MA_VOUCHER ?? row.voucherCode ?? ''),
    campaignCode: String(row.CHIEN_DICH_ID ?? row.campaignCode ?? ''), customerId: String(row.KHACH_HANG_ID ?? row.customerId ?? ''),
    customerName: String(row.TEN_KHACH_HANG ?? row.customerName ?? ''), discountType: String(row.LOAI_GIAM_GIA ?? row.discountType ?? ''),
    discountValue: Number(row.GIA_TRI_GIAM ?? row.discountValue ?? 0), startDate: row.NGAY_BAT_DAU ?? row.startDate ?? '',
    endDate: row.NGAY_KET_THUC ?? row.endDate ?? '', used: used === true || used === 1, selected: false };
}
