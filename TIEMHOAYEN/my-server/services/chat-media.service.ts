import { createHash, randomBytes } from 'node:crypto';
import { GridFSBucket } from 'mongodb';
import { getDb } from '../mongo.js';
import { InventoryError } from './inventory/helpers.js';

const BUCKET = 'TIN_NHAN_CHAT_MEDIA';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TOKEN_PATTERN = /^cm_[a-f0-9]{64}$/;

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export type StoredChatMedia = { url: string; storageKey: string };

export async function storeChatImage(dataUrl: string, ticketId: string): Promise<StoredChatMedia> {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(String(dataUrl || ''));
    if (!match)
        throw new InventoryError(400, 'Ảnh phải là JPG, PNG hoặc WEBP và không quá 5MB.');
    const data = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (!data.length || data.length > MAX_IMAGE_BYTES)
        throw new InventoryError(400, 'Ảnh phải là JPG, PNG hoặc WEBP và không quá 5MB.');
    const mime = match[1] === 'jpeg' ? 'image/jpeg' : `image/${match[1]}`;
    const token = `cm_${randomBytes(32).toString('hex')}`;
    const storageKey = digest(token);
    const bucket = new GridFSBucket(await getDb(), { bucketName: BUCKET });
    const upload = bucket.openUploadStream(storageKey, {
        metadata: { mime, ticketId, size: data.length, createdAt: new Date() },
    });
    await new Promise<void>((resolve, reject) => {
        upload.once('finish', () => resolve());
        upload.once('error', reject);
        upload.end(data);
    });
    return { url: `/api/support/media/${token}`, storageKey };
}

export async function deleteChatImage(storageKey: string) {
    const bucket = new GridFSBucket(await getDb(), { bucketName: BUCKET });
    const file = await bucket.find({ filename: storageKey }).next();
    if (file)
        await bucket.delete(file._id);
}

export async function openChatImage(token: string) {
    if (!TOKEN_PATTERN.test(token))
        throw new InventoryError(404, 'Không tìm thấy ảnh.');
    const bucket = new GridFSBucket(await getDb(), { bucketName: BUCKET });
    const file = await bucket.find({ filename: digest(token) }).next();
    if (!file)
        throw new InventoryError(404, 'Không tìm thấy ảnh.');
    return { file, stream: bucket.openDownloadStream(file._id) };
}
