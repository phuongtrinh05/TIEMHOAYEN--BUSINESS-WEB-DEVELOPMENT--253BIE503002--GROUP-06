import { createHmac, randomUUID } from 'node:crypto';

export async function sendAppsScriptOtp(to: string, code: string): Promise<void> {
  const endpoint = process.env.APPS_SCRIPT_OTP_URL?.trim() || '';
  const secret = process.env.APPS_SCRIPT_OTP_SECRET || '';
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint) || secret.length < 32) {
    throw new Error('APPS_SCRIPT_CONFIGURATION_INVALID');
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to) || !/^\d{6}$/.test(code)) throw new Error('OTP_INPUT_INVALID');
  const payload = JSON.stringify({ to, code, timestamp: Date.now(), requestId: randomUUID() });
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, signature }), signal: AbortSignal.timeout(15000),
    redirect: 'manual',
  });
  // ContentService returns a one-time Google-hosted GET URL. Never forward the POST body.
  let result = response;
  if (response.status === 302 || response.status === 303) {
    const location = new URL(response.headers.get('location') || '');
    if (location.protocol !== 'https:' || location.hostname !== 'script.googleusercontent.com') throw new Error('APPS_SCRIPT_REDIRECT_INVALID');
    result = await fetch(location, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  }
  if (!result.ok || (await result.json() as { ok?: boolean }).ok !== true) throw new Error('APPS_SCRIPT_SEND_FAILED');
}
