/** Operational guidance, not an automatic promise of delivery or callback SLA. */
export function requestWorkflow(row: any, now = new Date()) {
  const delivery = row.quote?.delivery || row.delivery || {};
  const raw = String(delivery.date || '');
  const date = /^\d{2}\/\d{2}\/\d{4}$/.test(raw) ? raw.split('/').reverse().join('-') : raw;
  const times = String(delivery.time || '').match(/\b(?:[01]\d|2[0-3]):[0-5]\d\b/g) || [];
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const start = validDate ? new Date(`${date}T${times[0] || '00:00'}:00+07:00`) : null;
  const end = validDate ? new Date(`${date}T${times[times.length - 1] || '23:59'}:59+07:00`) : null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const expired = !!end && Number.isFinite(end.getTime()) && end < now;
  const nearMinutes = Number(process.env.SALES_URGENT_WINDOW_MINUTES || 120);
  const near = !!start && Number.isFinite(start.getTime()) && start.getTime() - now.getTime() <= (nearMinutes > 0 ? nearMinutes : 120) * 60000;
  const urgent = date === today || near || expired;
  const status = row.status;
  let nextAction = urgent ? 'Gọi người đặt để kiểm tra lịch giao' : 'Kiểm tra nguồn hoa và liên hệ người đặt';
  let customerStatus = 'Chờ shop kiểm tra';
  let instruction = urgent ? 'Bạn cần giao sớm. Shop chưa xác nhận giao kịp và sẽ ưu tiên liên hệ số người đặt. Nếu cần ngay, hãy liên hệ shop; không thanh toán khi chưa được xác nhận.'
    : 'Shop đang kiểm tra nguồn hoa và lịch giao. Đây là yêu cầu tư vấn, chưa phải đơn đã xác nhận; bạn chưa cần thanh toán.';
  if (status === 'Sales đang xử lý') { customerStatus = 'Nhân viên đang xử lý'; nextAction = urgent ? 'Gọi khách, kiểm tra kho và lịch giao' : 'Kiểm tra hàng và chuẩn bị phương án'; }
  if (row.contactStatus === 'unreachable') { customerStatus = 'Shop chưa liên lạc được'; nextAction = 'Gọi lại người đặt'; instruction = 'Shop đã gọi nhưng chưa liên lạc được. Bạn có thể nhắn thời gian tiện nghe máy trong cuộc tư vấn.'; }
  if (status === 'Chờ khách xác nhận') { customerStatus = 'Có phương án cần bạn xác nhận'; nextAction = urgent ? 'Gọi khách để chốt phương án' : 'Theo dõi phản hồi phương án'; instruction = 'Bạn hãy kiểm tra mẫu, ảnh, giá và lịch giao trước khi đồng ý hoặc yêu cầu tư vấn lại.'; }
  if (status === 'Khách đã đồng ý') { customerStatus = 'Đã thống nhất phương án'; nextAction = 'Kiểm tra tồn và tạo đơn'; instruction = 'Shop sẽ kiểm tra lại hàng trước khi tạo đơn. Bạn chỉ thanh toán sau khi nhận được đơn và hướng dẫn thanh toán.'; }
  if (expired && !['Đã lên đơn','Đã từ chối','Đã tư vấn','Khách đã hủy'].includes(status)) { customerStatus = 'Cần thống nhất lại lịch giao'; nextAction = 'Liên hệ khách để đổi lịch hoặc dừng yêu cầu'; instruction = 'Lịch giao đang trao đổi đã qua. Hãy chọn lịch mới hoặc nhắn nhân viên; shop chưa nhận đơn cho lịch cũ.'; }
  if (status === 'Đã lên đơn') { customerStatus = 'Đã tạo đơn hàng'; nextAction = 'Theo dõi đơn hàng'; instruction = 'Phương án đã được chuyển thành đơn. Xem đơn để kiểm tra thanh toán và tiến độ.'; }
  if (status === 'Đã từ chối' || status === 'Đã tư vấn') { customerStatus = 'Yêu cầu đã kết thúc'; nextAction = 'Xem kết quả xử lý'; instruction = row.customerMessage || 'Shop đã kết thúc yêu cầu này.'; }
  if (status === 'Khách đã hủy') { customerStatus = 'Bạn đã dừng yêu cầu'; nextAction = 'Không cần xử lý tiếp'; instruction = 'Yêu cầu đã dừng và không tạo đơn mới.'; }
  return { urgency: urgent ? 'urgent' : validDate ? 'scheduled' : 'unknown', deliveryAt: start && Number.isFinite(start.getTime()) ? start.toISOString() : null,
    scheduleExpired: expired, preferredContact: urgent ? 'phone' : 'chat', nextAction, customerStatus, instruction,
    contactStatus: row.contactStatus || 'not_contacted', followUpAt: row.followUpAt || null };
}
