// Script property: MARKETING_SHARED_SECRET (same private value as APPS_SCRIPT_MARKETING_SECRET on Render).
function doGet() {
  return marketingResult_(true, 'READY');
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents || e.postData.contents.length > 24000) {
      return marketingResult_(false, 'INVALID_ENVELOPE');
    }
    var envelope = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('MARKETING_SHARED_SECRET');
    if (!secret || secret.length < 32 || typeof envelope.payload !== 'string') {
      return marketingResult_(false, 'CONFIGURATION_INVALID');
    }
    var expected = Utilities.computeHmacSha256Signature(envelope.payload, secret, Utilities.Charset.UTF_8)
      .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    if (typeof envelope.signature !== 'string' || envelope.signature.length !== expected.length) {
      return marketingResult_(false, 'SIGNATURE_INVALID');
    }
    var mismatch = 0;
    for (var i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ envelope.signature.charCodeAt(i);
    if (mismatch) return marketingResult_(false, 'SIGNATURE_INVALID');

    var data = JSON.parse(envelope.payload);
    if (data.type !== 'marketing'
        || !Number.isFinite(data.timestamp) || Math.abs(Date.now() - data.timestamp) > 30000
        || typeof data.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(data.requestId)
        || typeof data.to !== 'string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(data.to)
        || typeof data.subject !== 'string' || !data.subject.trim() || data.subject.length > 200
        || typeof data.body !== 'string' || !data.body.trim() || data.body.length > 10000) {
      return marketingResult_(false, 'PAYLOAD_INVALID');
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return marketingResult_(false, 'BUSY');
    try {
      var cache = CacheService.getScriptCache();
      var cacheKey = 'marketing_' + data.requestId;
      if (cache.get(cacheKey)) return marketingResult_(true, 'ALREADY_SENT');
      if (MailApp.getRemainingDailyQuota() < 1) return marketingResult_(false, 'QUOTA_EXCEEDED');
      MailApp.sendEmail({
        to: data.to,
        name: 'Tiệm Hoa Yên',
        subject: data.subject.trim(),
        body: data.body.trim()
      });
      // Backend retries within minutes; six hours prevents duplicate Gmail sends after a lost response.
      cache.put(cacheKey, 'sent', 21600);
      return marketingResult_(true, 'SENT');
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return marketingResult_(false, 'INTERNAL_ERROR');
  }
}

function marketingResult_(ok, code) {
  return ContentService.createTextOutput(JSON.stringify({ ok: ok, code: code }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Run once in the Apps Script editor to request Gmail send permission; sends no email.
function authorizeMarketingMail() {
  return MailApp.getRemainingDailyQuota();
}
