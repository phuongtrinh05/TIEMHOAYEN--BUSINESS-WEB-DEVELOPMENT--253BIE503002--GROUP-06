// Script properties: OTP_SHARED_SECRET (same private value as backend).
function doPost(e) {
  try {
    if (!e || !e.postData || e.postData.contents.length > 4096) return otpResult_(false);
    var envelope = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('OTP_SHARED_SECRET');
    if (!secret || secret.length < 32 || typeof envelope.payload !== 'string') return otpResult_(false);
    var expected = Utilities.computeHmacSha256Signature(envelope.payload, secret, Utilities.Charset.UTF_8)
      .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    if (typeof envelope.signature !== 'string' || envelope.signature.length !== expected.length) return otpResult_(false);
    var mismatch = 0;
    for (var i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ envelope.signature.charCodeAt(i);
    if (mismatch) return otpResult_(false);
    var data = JSON.parse(envelope.payload);
    if (!Number.isFinite(data.timestamp) || Math.abs(Date.now() - data.timestamp) > 30000 ||
        typeof data.requestId !== 'string' || !/^[\w-]{36}$/.test(data.requestId) ||
        typeof data.to !== 'string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(data.to) ||
        typeof data.code !== 'string' || !/^\d{6}$/.test(data.code)) return otpResult_(false);
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) return otpResult_(false);
    try {
      var cache = CacheService.getScriptCache();
      if (cache.get(data.requestId) || MailApp.getRemainingDailyQuota() < 1) return otpResult_(false);
      cache.put(data.requestId, 'used', 120);
      MailApp.sendEmail({
        to: data.to, name: 'Tiệm Hoa Yên', subject: 'Tiệm Hoa Yên - Mã xác minh',
        body: 'Mã xác minh của bạn: ' + data.code + '. Mã chỉ có hiệu lực 60 giây. Không chia sẻ mã này với người khác.'
      });
      return otpResult_(true);
    } finally { lock.releaseLock(); }
  } catch (error) { return otpResult_(false); }
}

function otpResult_(ok) {
  return ContentService.createTextOutput(JSON.stringify({ ok: ok })).setMimeType(ContentService.MimeType.JSON);
}

// Run once in the editor to request only the send-mail permission; sends no email.
function authorizeMail() { return MailApp.getRemainingDailyQuota(); }
