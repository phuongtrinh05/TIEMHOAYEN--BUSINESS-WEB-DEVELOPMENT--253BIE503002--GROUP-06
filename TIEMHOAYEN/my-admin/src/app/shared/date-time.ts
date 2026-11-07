/** Định dạng thời gian thống nhất toàn Admin: "dd/MM/yyyy HH:mm" (24h) theo giờ Việt Nam. */
export function formatDateTime24(value: unknown): string {
  const date = new Date(value as any);
  if (!Number.isFinite(date.getTime())) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${p['day']}/${p['month']}/${p['year']} ${p['hour']}:${p['minute']}`;
}
