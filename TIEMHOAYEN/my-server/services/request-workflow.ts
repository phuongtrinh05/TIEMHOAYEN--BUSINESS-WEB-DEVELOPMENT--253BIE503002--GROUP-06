/** Operational guidance, not an automatic promise of delivery or callback SLA. */
export function requestWorkflow(row: any, now = new Date()) {
  const delivery = row.quote?.delivery || row.delivery || {};
  const raw = String(delivery.date || '');
  const date = /^\d{2}\/\d{2}\/\d{4}$/.test(raw) ? raw.split('/').reverse().join('-') : raw;
  const times = String(delivery.time || '').match(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/g) || [];
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const start = validDate ? new Date(`${date}T${times[0] || '00:00'}:00+07:00`) : null;
  const end = validDate ? new Date(`${date}T${times[times.length - 1] || '23:59'}:59+07:00`) : null;
  const minutesUntilDelivery = start && Number.isFinite(start.getTime()) ? (start.getTime() - now.getTime()) / 60000 : null;
  const expired = !!end && Number.isFinite(end.getTime()) && end < now;
  const deliveryHour = times.length ? Number(String(times[0]).slice(0, 2)) : null;
  const outsideHours = deliveryHour !== null && (deliveryHour < 8 || deliveryHour >= 22);
  const items = row.quote?.items || row.items || [];
  const totalQuantity = items.reduce((sum: number, item: any) => sum + Math.max(0, Number(item.qty ?? item.quantity ?? 0) || 0), 0);
  const status = String(row.status || '');
  const isLargeOrder = totalQuantity >= 10;
  // A past schedule is no longer an emergency that can still be fulfilled.
  // Keep it visible for rescheduling/closure, but do not count or label it as
  // “Khẩn cấp”.
  const isEmergency = !expired && (
    minutesUntilDelivery !== null && minutesUntilDelivery >= 0 && minutesUntilDelivery <= 180
    || outsideHours && minutesUntilDelivery !== null && minutesUntilDelivery >= 0 && minutesUntilDelivery < 720
  );

  let severityRank = 4;
  let severity = 'NORMAL';
  let priorityLabel = 'Theo lịch hẹn';
  const priorityReasons: string[] = [];
  if (isEmergency) {
    severityRank = 0; severity = 'CRITICAL'; priorityLabel = 'Khẩn cấp';
    if (minutesUntilDelivery !== null && minutesUntilDelivery <= 60) priorityReasons.push('Còn không quá 1 giờ đến lịch giao');
    else if (minutesUntilDelivery !== null && minutesUntilDelivery <= 180) priorityReasons.push('Còn không quá 3 giờ đến lịch giao');
    else priorityReasons.push('Lịch giao ngoài 08:00–22:00 và còn dưới 12 giờ');
  } else if (isLargeOrder && !expired) {
    severityRank = 1; severity = 'ATTENTION'; priorityLabel = 'Đơn lớn';
    priorityReasons.push(`Đơn ${totalQuantity} bó cần kiểm tra NVL và kế hoạch chuẩn bị`);
  }
  if (isLargeOrder && isEmergency) priorityReasons.push(`Đơn lớn: ${totalQuantity} bó`);

  const urgent = isEmergency || isLargeOrder && !expired;
  let nextAction = urgent ? 'Liên hệ người đặt và kiểm tra khả năng đáp ứng' : 'Kiểm tra nguồn hoa và liên hệ người đặt';
  let customerStatus = status === 'Chờ Sales tiếp nhận' ? 'Chờ Sales tiếp nhận' : 'Chờ shop kiểm tra';
  let instruction = urgent ? 'Yêu cầu cần được shop kiểm tra sớm. Shop chưa xác nhận giao kịp; bạn chưa cần thanh toán.'
    : 'Shop đang kiểm tra nguồn hoa và lịch giao. Đây là yêu cầu tư vấn, chưa phải đơn đã xác nhận; bạn chưa cần thanh toán.';
  if (status === 'Sales đang xử lý') { customerStatus = 'Sales đang xử lý'; nextAction = urgent ? 'Kiểm tra kho, lịch chuẩn bị và liên hệ khách' : 'Kiểm tra hàng và chuẩn bị phương án'; }
  if (row.contactStatus === 'unreachable') { customerStatus = 'Shop chưa liên lạc được'; nextAction = 'Gọi lại người đặt'; instruction = 'Shop đã gọi nhưng chưa liên lạc được. Bạn có thể nhắn thời gian tiện nghe máy trong cuộc tư vấn.'; }
  if (status === 'Chờ khách xác nhận') { customerStatus = 'Chờ xác nhận'; nextAction = urgent ? 'Liên hệ khách để chốt phương án sớm' : 'Theo dõi phản hồi phương án'; instruction = 'Bạn hãy kiểm tra mẫu, ảnh, giá và lịch giao trước khi đồng ý hoặc yêu cầu tư vấn lại.'; }
  if (status === 'Khách đã đồng ý') { customerStatus = 'Đã thống nhất phương án'; nextAction = 'Kiểm tra tồn và tạo đơn'; instruction = 'Shop sẽ kiểm tra lại hàng trước khi tạo đơn. Bạn chỉ thanh toán sau khi nhận được đơn và hướng dẫn thanh toán.'; }
  if (['Chờ thanh toán','Chờ khách thanh toán'].includes(status)) { customerStatus = 'Chờ khách thanh toán'; nextAction = 'Theo dõi thanh toán'; instruction = 'Shop đã xác nhận yêu cầu và tạo đơn. Bạn hãy thanh toán khoản cần trả trước để shop chính thức tiếp nhận đơn.'; }
  if (status === 'Hết hạn thanh toán') { customerStatus = 'Đã hủy yêu cầu'; nextAction = 'Yêu cầu đã kết thúc'; instruction = 'Yêu cầu đã hết thời hạn thanh toán. Bạn có thể chọn hoa và gửi yêu cầu mới khi cần.'; }
  if (expired && !['Chờ thanh toán','Chờ khách thanh toán','Đã lên đơn','Đã từ chối','Đã tư vấn','Khách đã hủy'].includes(status)) { customerStatus = 'Cần thống nhất lại lịch giao'; nextAction = 'Liên hệ khách để đổi lịch hoặc dừng yêu cầu'; instruction = 'Lịch giao đang trao đổi đã qua. Hãy chọn lịch mới hoặc nhắn nhân viên; shop chưa nhận đơn cho lịch cũ.'; }
  if (status === 'Đã lên đơn') { customerStatus = 'Đã tạo đơn hàng'; nextAction = 'Theo dõi đơn hàng'; instruction = 'Phương án đã được chuyển thành đơn. Xem đơn để kiểm tra thanh toán và tiến độ.'; }
  if (status === 'Đã từ chối' || status === 'Đã tư vấn') { customerStatus = 'Yêu cầu đã kết thúc'; nextAction = 'Xem kết quả xử lý'; instruction = row.customerMessage || 'Shop đã kết thúc yêu cầu này.'; }
  if (status === 'Khách đã hủy') { customerStatus = 'Đã hủy yêu cầu'; nextAction = 'Không cần xử lý tiếp'; instruction = 'Yêu cầu đã dừng và không tạo đơn mới.'; }
  return { urgency: urgent ? 'urgent' : validDate ? 'scheduled' : 'unknown', severity, severityRank, priorityLabel, priorityReasons,
    isEmergency, isLargeOrder: isLargeOrder && !expired,
    totalQuantity, outsideHours, minutesUntilDelivery: minutesUntilDelivery === null ? null : Math.round(minutesUntilDelivery),
    deliveryAt: start && Number.isFinite(start.getTime()) ? start.toISOString() : null, scheduleExpired: expired,
    preferredContact: urgent ? 'phone' : 'chat', nextAction, customerStatus, instruction,
    contactStatus: row.contactStatus || 'not_contacted', followUpAt: row.followUpAt || null };
}
