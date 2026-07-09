import { Request, Response } from 'express';
import { sql } from '../db.js';

const createNextContactId = async (): Promise<string> => {
  const result = await sql.query(`
    SELECT MAX(TRY_CONVERT(INT, SUBSTRING(LIEN_HE_ID, 3, 20))) AS MAX_NUM
    FROM LIEN_HE
    WHERE LIEN_HE_ID LIKE N'LH%'
  `);

  const maxNumber = Number(result.recordset?.[0]?.MAX_NUM || 0);
  const nextNumber = maxNumber + 1;

  return `LH${nextNumber.toString().padStart(5, '0')}`;
};

export const createContact = async (req: Request, res: Response) => {
  try {
    const fullName = String(req.body?.fullName || req.body?.hoTen || '').trim();

    const phoneOrEmail = String(
      req.body?.phoneOrEmail ||
      req.body?.contactInfo ||
      req.body?.thongTinLienHe ||
      req.body?.phone ||
      req.body?.email ||
      ''
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

    const contactId = await createNextContactId();

    const request = new sql.Request();
    request.input('LIEN_HE_ID', sql.NVarChar(20), contactId);
    request.input('HO_TEN', sql.NVarChar(100), fullName);
    request.input('THONG_TIN_LIEN_HE', sql.NVarChar(100), phoneOrEmail);
    request.input('CHU_DE', sql.NVarChar(100), subject);
    request.input('NOI_DUNG', sql.NVarChar(1000), message);

    await request.query(`
      INSERT INTO LIEN_HE (
        LIEN_HE_ID,
        HO_TEN,
        THONG_TIN_LIEN_HE,
        CHU_DE,
        NOI_DUNG,
        TRANG_THAI,
        NGAY_TAO
      )
      VALUES (
        @LIEN_HE_ID,
        @HO_TEN,
        @THONG_TIN_LIEN_HE,
        @CHU_DE,
        @NOI_DUNG,
        N'Chưa xử lý',
        GETDATE()
      )
    `);

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
    const result = await sql.query(`
      SELECT
        LIEN_HE_ID,
        HO_TEN,
        THONG_TIN_LIEN_HE,
        CHU_DE,
        NOI_DUNG,
        TRANG_THAI,
        NGAY_TAO
      FROM LIEN_HE
      ORDER BY NGAY_TAO DESC
    `);

    return res.status(200).json(result.recordset);
  } catch (error: any) {
    console.error('Lỗi lấy liên hệ:', error);
    return res.status(500).json({
      message: 'Không thể lấy danh sách liên hệ: ' + error.message,
    });
  }
};
