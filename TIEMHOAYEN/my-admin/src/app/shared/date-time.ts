/** Định dạng thời gian thống nhất toàn Admin: "dd/MM/yyyy HH:mm" (24h) theo giờ Việt Nam. */
export function formatDateTime24(value: unknown): string {
  const date = new Date(value as any);
  if (!Number.isFinite(date.getTime())) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${p['day']}/${p['month']}/${p['year']} ${p['hour']}:${p['minute']}`;
}

/** Nhãn khung giờ giao 30 phút: "08:00" → "08:00 - 08:30"; dữ liệu đã là khoảng thì giữ khoảng. */
export function deliverySlotLabel(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text || /(AM|PM)/i.test(text)) return text;
  const times = [...text.matchAll(/(\d{1,2}):([0-5]\d)/g)].map(m => `${m[1].padStart(2, '0')}:${m[2]}`);
  if (!times.length) return text;
  if (times.length > 1) return `${times[0]} - ${times[1]}`;
  const end = Math.min(Number(times[0].slice(0, 2)) * 60 + Number(times[0].slice(3)) + 30, 24 * 60 - 1);
  return `${times[0]} - ${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}
