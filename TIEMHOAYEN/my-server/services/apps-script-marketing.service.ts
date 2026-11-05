import { createHmac } from 'node:crypto';

type MarketingMail = {
  to: string;
  subject: string;
  body: string;
  requestId: string;
};

const endpointPattern = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;
const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const requestIdPattern = /^[A-Za-z0-9_-]{16,128}$/;

export function appsScriptMarketingReady(): boolean {
  const endpoint = process.env.APPS_SCRIPT_MARKETING_URL?.trim() || '';
  const secret = process.env.APPS_SCRIPT_MARKETING_SECRET || '';
  return endpointPattern.test(endpoint) && secret.length >= 32;
}

export async function sendAppsScriptMarketingEmail(mail: MarketingMail): Promise<string> {
  const endpoint = process.env.APPS_SCRIPT_MARKETING_URL?.trim() || '';
  const secret = process.env.APPS_SCRIPT_MARKETING_SECRET || '';
  if (!endpointPattern.test(endpoint) || secret.length < 32) throw new Error('APPS_SCRIPT_MARKETING_CONFIGURATION_INVALID');
  if (!emailPattern.test(mail.to) || !mail.subject.trim() || mail.subject.length > 200
    || !mail.body.trim() || mail.body.length > 10000 || !requestIdPattern.test(mail.requestId)) {
    throw new Error('APPS_SCRIPT_MARKETING_INPUT_INVALID');
  }

  const payload = JSON.stringify({
    type: 'marketing',
    to: mail.to,
    subject: mail.subject.trim(),
    body: mail.body.trim(),
    timestamp: Date.now(),
    requestId: mail.requestId,
  });
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, signature }),
    signal: AbortSignal.timeout(15000),
    redirect: 'manual',
  });

  // Apps Script ContentService returns its JSON through a one-time Google-hosted URL.
  let result = response;
  if (response.status === 302 || response.status === 303) {
    const location = new URL(response.headers.get('location') || '');
    if (location.protocol !== 'https:' || location.hostname !== 'script.googleusercontent.com') {
      throw new Error('APPS_SCRIPT_MARKETING_REDIRECT_INVALID');
    }
    result = await fetch(location, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  }

  let data: { ok?: boolean; code?: string } = {};
  try { data = await result.json() as typeof data; } catch { throw new Error('APPS_SCRIPT_MARKETING_RESPONSE_INVALID'); }
  if (!result.ok || data.ok !== true || !['SENT', 'ALREADY_SENT'].includes(String(data.code || ''))) {
    throw new Error('APPS_SCRIPT_MARKETING_SEND_FAILED:' + String(data.code || result.status));
  }
  return `apps-script:${mail.requestId}:${data.code}`;
}
