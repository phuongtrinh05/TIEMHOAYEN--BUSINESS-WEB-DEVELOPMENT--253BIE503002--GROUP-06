import { Request, Response } from 'express';
import { sql } from '../db.js';

const DEFAULT_BLOG_STATUS = 'Hiển thị';
const DEFAULT_STAFF_ID = 'NV001';

const getBlogSelectQuery = (whereClause = '') => `
  SELECT
    bv.BAI_VIET_ID,
    bv.NHAN_VIEN_ID,
    nv.HO_TEN AS TEN_NHAN_VIEN,
    nv.EMAIL AS EMAIL_NHAN_VIEN,
    bv.TIEU_DE,
    bv.NOI_DUNG,
    bv.ANH_BIA,
    bv.DANH_MUC_BLOG,
    bv.NGAY_DANG,
    bv.TRANG_THAI,
    bv.LUOT_XEM
  FROM BAI_VIET bv
  LEFT JOIN NHAN_VIEN nv
    ON bv.NHAN_VIEN_ID = nv.NHAN_VIEN_ID
  ${whereClause}
`;

const resolveStaffId = async (staffId: unknown, author: unknown, email?: unknown): Promise<string> => {
  const normalizedStaffId = String(staffId || '').trim();

  if (normalizedStaffId) {
    return normalizedStaffId;
  }

  const normalizedEmail = String(email || '').trim();

  if (normalizedEmail) {
    const result = await sql.query`
      SELECT TOP 1 NHAN_VIEN_ID
      FROM NHAN_VIEN
      WHERE EMAIL = ${normalizedEmail}
      ORDER BY NHAN_VIEN_ID ASC
    `;

    if (result.recordset.length > 0) {
      return result.recordset[0].NHAN_VIEN_ID;
    }
  }

  const authorName = String(author || '').trim();

  if (authorName) {
    const result = await sql.query`
      SELECT TOP 1 NHAN_VIEN_ID
      FROM NHAN_VIEN
      WHERE HO_TEN = ${authorName}
      ORDER BY NHAN_VIEN_ID ASC
    `;

    if (result.recordset.length > 0) {
      return result.recordset[0].NHAN_VIEN_ID;
    }
  }

  const fallback = await sql.query`
    SELECT TOP 1 NHAN_VIEN_ID
    FROM NHAN_VIEN
    ORDER BY NHAN_VIEN_ID ASC
  `;

  return fallback.recordset[0]?.NHAN_VIEN_ID || DEFAULT_STAFF_ID;
};

const getNextBlogId = async (): Promise<string> => {
  const result = await sql.query`
    SELECT ISNULL(MAX(TRY_CONVERT(INT, REPLACE(BAI_VIET_ID, 'BV', ''))), 0) + 1 AS NEXT_NUM
    FROM BAI_VIET
    WHERE BAI_VIET_ID LIKE 'BV%'
  `;

  const nextNum = Number(result.recordset[0]?.NEXT_NUM || 1);
  return 'BV' + String(nextNum).padStart(3, '0');
};

export const getAllBlogs = async (_req: Request, res: Response) => {
  try {
    const result = await sql.query(`
      ${getBlogSelectQuery()}
      ORDER BY bv.NGAY_DANG DESC, bv.BAI_VIET_ID DESC
    `);

    return res.status(200).json(result.recordset);
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load blogs: ' + error.message });
  }
};

export const getBlogById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const request = new sql.Request();
    request.input('BAI_VIET_ID', sql.NVarChar(10), id);
    const result = await request.query(`
      ${getBlogSelectQuery('WHERE bv.BAI_VIET_ID = @BAI_VIET_ID')}
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy bài viết.' });
    }

    return res.status(200).json(result.recordset[0]);
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load blog: ' + error.message });
  }
};

export const createBlog = async (req: Request, res: Response) => {
  try {
    const { title, content, coverImage, category, status, staffId, author, email } = req.body;

    if (!String(title || '').trim() || !String(content || '').trim() || !String(category || '').trim()) {
      return res.status(400).json({ message: 'Thiếu tiêu đề, nội dung hoặc danh mục bài viết.' });
    }

    const blogId = await getNextBlogId();
    const resolvedStaffId = await resolveStaffId(staffId, author, email);
    const request = new sql.Request();
    request.input('BAI_VIET_ID', sql.NVarChar(10), blogId);
    request.input('NHAN_VIEN_ID', sql.NVarChar(10), resolvedStaffId);
    request.input('TIEU_DE', sql.NVarChar(500), String(title).trim());
    request.input('NOI_DUNG', sql.NVarChar(sql.MAX), String(content || '').trim());
    request.input('ANH_BIA', sql.NVarChar(500), String(coverImage || '').trim() || null);
    request.input('DANH_MUC_BLOG', sql.NVarChar(100), String(category).trim());
    request.input('TRANG_THAI', sql.NVarChar(50), String(status || DEFAULT_BLOG_STATUS).trim());

    await request.query(`
      INSERT INTO BAI_VIET (
        BAI_VIET_ID,
        NHAN_VIEN_ID,
        TIEU_DE,
        NOI_DUNG,
        ANH_BIA,
        DANH_MUC_BLOG,
        NGAY_DANG,
        TRANG_THAI,
        LUOT_XEM
      )
      VALUES (
        @BAI_VIET_ID,
        @NHAN_VIEN_ID,
        @TIEU_DE,
        @NOI_DUNG,
        @ANH_BIA,
        @DANH_MUC_BLOG,
        GETDATE(),
        @TRANG_THAI,
        0
      )
    `);

    const created = await request.query(`
      ${getBlogSelectQuery('WHERE bv.BAI_VIET_ID = @BAI_VIET_ID')}
    `);

    return res.status(201).json({
      message: 'Blog created.',
      blog: created.recordset[0],
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot create blog: ' + error.message });
  }
};

export const updateBlog = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, content, coverImage, category, status, staffId, author, email } = req.body;

    if (!id || !String(title || '').trim() || !String(content || '').trim() || !String(category || '').trim()) {
      return res.status(400).json({ message: 'Thiếu thông tin bài viết.' });
    }

    const resolvedStaffId = await resolveStaffId(staffId, author, email);
    const request = new sql.Request();
    request.input('BAI_VIET_ID', sql.NVarChar(10), id);
    request.input('NHAN_VIEN_ID', sql.NVarChar(10), resolvedStaffId);
    request.input('TIEU_DE', sql.NVarChar(500), String(title).trim());
    request.input('NOI_DUNG', sql.NVarChar(sql.MAX), String(content || '').trim());
    request.input('ANH_BIA', sql.NVarChar(500), String(coverImage || '').trim() || null);
    request.input('DANH_MUC_BLOG', sql.NVarChar(100), String(category).trim());
    request.input('TRANG_THAI', sql.NVarChar(50), String(status || DEFAULT_BLOG_STATUS).trim());

    const result = await request.query(`
      UPDATE BAI_VIET
      SET
        NHAN_VIEN_ID = @NHAN_VIEN_ID,
        TIEU_DE = @TIEU_DE,
        NOI_DUNG = @NOI_DUNG,
        ANH_BIA = @ANH_BIA,
        DANH_MUC_BLOG = @DANH_MUC_BLOG,
        TRANG_THAI = @TRANG_THAI
      WHERE BAI_VIET_ID = @BAI_VIET_ID;

      ${getBlogSelectQuery('WHERE bv.BAI_VIET_ID = @BAI_VIET_ID')}
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy bài viết.' });
    }

    return res.status(200).json({
      message: 'Blog updated.',
      blog: result.recordset[0],
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot update blog: ' + error.message });
  }
};

export const deleteBlog = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: 'Missing blog id.' });
    }

    const request = new sql.Request();
    request.input('BAI_VIET_ID', sql.NVarChar(10), id);
    const result = await request.query(`
      DELETE FROM BAI_VIET
      WHERE BAI_VIET_ID = @BAI_VIET_ID
    `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ message: 'Không tìm thấy bài viết.' });
    }

    return res.status(200).json({ message: 'Blog deleted.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete blog: ' + error.message });
  }
};
