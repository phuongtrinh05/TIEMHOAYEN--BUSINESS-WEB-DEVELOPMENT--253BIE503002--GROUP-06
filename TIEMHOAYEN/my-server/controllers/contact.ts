import { Request, Response } from 'express';
import { getCollection, getNextPrefixedId } from '../mongo.js';

const getContactCollection = () => getCollection('LIEN_HE');

export const createContact = async (req: Request, res: Response) => {
  try {
    const fullName = String(req.body?.fullName || req.body?.hoTen || '').trim();
    const phoneOrEmail = String(
      req.body?.phoneOrEmail ||
      req.body?.contactInfo ||
      req.body?.thongTinLienHe ||
      req.body?.phone ||
      req.body?.email ||
      '',
    ).trim();
    const subject = String(req.body?.subject || req.body?.chuDe || '').trim();
    const message = String(req.body?.message || req.body?.noiDung || '').trim();

    if (!fullName) {
      return res.status(400).json({ message: 'Vui lòng nhập họ và tên.' });
    }

    if (!phoneOrEmail) {
      return res.status(400).json({ message: 'Vui lòng nhập số điện thoại hoặc email.' });
    }

    if (!subject) {
      return res.status(400).json({ message: 'Vui lòng chọn chủ đề liên hệ.' });
    }

    if (!message) {
      return res.status(400).json({ message: 'Vui lòng nhập nội dung liên hệ.' });
    }

    const collection = await getContactCollection();
    const contactId = await getNextPrefixedId('LIEN_HE', 'LIEN_HE_ID', 'LH', 5);
    await collection.insertOne({
      LIEN_HE_ID: contactId,
      HO_TEN: fullName,
      THONG_TIN_LIEN_HE: phoneOrEmail,
      CHU_DE: subject,
      NOI_DUNG: message,
      TRANG_THAI: 'Chưa xử lý',
      NGAY_TAO: new Date(),
    });

    return res.status(201).json({
      message: 'Gửi liên hệ thành công. Tiệm Hoa Yên sẽ phản hồi bạn sớm nhất.',
      contactId,
    });
  } catch (error: any) {
    console.error('Lỗi tạo liên hệ:', error);
    return res.status(500).json({
      message: 'Không thể lưu liên hệ: ' + error.message,
    });
  }
};

export const getAllContacts = async (_req: Request, res: Response) => {
  try {
    const collection = await getContactCollection();
    const contacts = await collection.find({}).sort({ NGAY_TAO: -1 }).toArray();
    return res.status(200).json(contacts);
  } catch (error: any) {
    console.error('Lỗi lấy liên hệ:', error);
    return res.status(500).json({
      message: 'Không thể lấy danh sách liên hệ: ' + error.message,
    });
  }
};
