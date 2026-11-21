// Thiệp được chọn riêng trong bước đặt hàng.
export const PUBLIC_PRODUCT_FILTER = {
  TRANG_THAI: 'Đang bán',
  TEN_SAN_PHAM: { $not: /^\s*thi[eệ]p/i },
};
