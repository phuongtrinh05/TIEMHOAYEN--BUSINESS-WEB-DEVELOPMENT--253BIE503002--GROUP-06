import { Request, Response } from 'express';
import { getCollection, getNextPrefixedId } from '../mongo.js';
import { randomUUID } from 'node:crypto';
import { startSupport, sendSupport, supportStartRate } from '../services/support.service.js';
import { InventoryError } from '../services/inventory/helpers.js';
import { normalizeOrderPhone } from '../services/order-access.service.js';

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
    const isEmail=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(phoneOrEmail);
    if(!isEmail&&!normalizeOrderPhone(phoneOrEmail)) return res.status(400).json({message:'Nhập đúng SĐT hoặc email liên hệ.'});
    if(fullName.length>100||subject.length>200||message.length>2000)return res.status(400).json({message:'Nội dung vượt độ dài cho phép.'});
    const memberToken=String(req.headers['x-order-access']||'');
    await supportStartRate(req.ip||'unknown');
    const support=await startSupport({name:fullName,phone:isEmail?'':phoneOrEmail,email:isEmail?phoneOrEmail:''},{orderToken:memberToken},'Form');
    await sendSupport(support.ticket.id,{chatInput:`${subject}: ${message}`.slice(0,2000),messageId:randomUUID()},{orderToken:memberToken,guestToken:support.guestToken||''});

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
      HO_TRO_ID: support.ticket.id,
    });

    return res.status(201).json({
      message: 'Gửi liên hệ thành công. Tiệm Hoa Yên sẽ phản hồi bạn sớm nhất.',
      contactId,
      support,
    });
  } catch (error: any) {
    if(error instanceof InventoryError)return res.status(error.status).json({message:error.message});
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
