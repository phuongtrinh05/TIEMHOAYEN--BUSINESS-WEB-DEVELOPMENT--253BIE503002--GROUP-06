/**
 * Đồng nhất khung giờ về 24h "HH:mm" hoặc "HH:mm–HH:mm".
 * Dữ liệu cũ có dạng "09:00 AM–11:00 AM", "5:30 PM", "17h", "17h30". Chuỗi không nhận ra giờ thì giữ nguyên.
 */
export function slot24h(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const matches = [...text.matchAll(/(\d{1,2})\s*(?::|h)\s*([0-5]\d)?\s*(AM|PM|SA|CH)?/gi)];
  if (!matches.length) return text;
  const times = matches.slice(0, 2).map(m => {
    let hour = Number(m[1]);
    const minute = m[2] || '00';
    const period = (m[3] || '').toUpperCase();
    if (period === 'PM' || period === 'CH') hour = hour % 12 + 12;
    else if (period === 'AM' || period === 'SA') hour = hour % 12;
    return hour <= 23 ? `${String(hour).padStart(2, '0')}:${minute}` : '';
  }).filter(Boolean);
  return times.length ? times.join('–') : text;
}
