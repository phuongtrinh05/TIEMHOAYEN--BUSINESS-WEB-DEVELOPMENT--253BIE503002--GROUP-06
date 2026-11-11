// Keep the status groups aligned with the admin order request queue.
export function requestStatusTone(value: string) {
  if (value === 'Đã lên đơn') return 'success';
  if (['Chờ khách xác nhận', 'Chờ khách thanh toán', 'Chờ thanh toán'].includes(value)) return 'waiting';
  if (['Đã từ chối', 'Khách đã hủy'].includes(value)) return 'danger';
  return value === 'Chờ xử lý' || value === 'Chờ Sales tiếp nhận' ? 'new' : 'processing';
}
