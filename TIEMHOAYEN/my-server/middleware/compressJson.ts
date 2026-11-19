import type { NextFunction, Request, Response } from 'express';
import { gzip } from 'node:zlib';

/**
 * Nén gzip cho phản hồi JSON (danh sách sản phẩm ~430KB → ~60KB), dùng zlib có sẵn của Node, không cần cài thêm gói.
 * Chỉ nén khi trình duyệt chấp nhận gzip và dữ liệu đủ lớn. Tắt bằng JSON_GZIP=false.
 */
const MIN_BYTES = 2048;

export const compressJson = (req: Request, res: Response, next: NextFunction) => {
  if (process.env.JSON_GZIP === 'false' || !/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return next();

  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.headersSent || res.getHeader('Content-Encoding')) return originalJson(body);
    const app = req.app;
    const text = JSON.stringify(body, app.get('json replacer'), app.get('json spaces'));
    if (text === undefined || Buffer.byteLength(text) < MIN_BYTES) return originalJson(body);

    gzip(text, { level: 6 }, (error, zipped) => {
      if (error || res.headersSent) {
        if (!res.headersSent) originalJson(body);
        return;
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Encoding', 'gzip');
      res.append('Vary', 'Accept-Encoding');
      res.setHeader('Content-Length', String(zipped.length));
      res.end(req.method === 'HEAD' ? undefined : zipped);
    });
    return res;
  }) as Response['json'];
  next();
};
