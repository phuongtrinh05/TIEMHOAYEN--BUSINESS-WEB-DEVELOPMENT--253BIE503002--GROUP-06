/** Gmail HTTPS transport: compatible with hosting that blocks SMTP ports. */
export async function sendGmailOtp(to: string, code: string): Promise<void> {
  const sender = process.env.GMAIL_SENDER?.trim();
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!sender || !clientId || !clientSecret || !refreshToken) throw new Error('GMAIL_CONFIGURATION_MISSING');
  if (![sender, to].every(value => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value))) throw new Error('GMAIL_ADDRESS_INVALID');
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(10000), redirect: 'error',
  });
  if (!tokenResponse.ok) throw new Error('GMAIL_AUTHENTICATION_FAILED');
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) throw new Error('GMAIL_AUTHENTICATION_FAILED');
  const text = `Mã xác minh Tiệm Hoa Yên của bạn: ${code}. Mã chỉ có hiệu lực 60 giây. Không chia sẻ mã này với người khác.`;
  const raw = Buffer.from([
    `From: ${sender}`, `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from('Tiệm Hoa Yên - Mã xác minh').toString('base64')}?=`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(text).toString('base64'),
  ].join('\r\n')).toString('base64url');
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }), signal: AbortSignal.timeout(10000), redirect: 'error',
  });
  if (!response.ok) throw new Error('GMAIL_SEND_FAILED');
}
