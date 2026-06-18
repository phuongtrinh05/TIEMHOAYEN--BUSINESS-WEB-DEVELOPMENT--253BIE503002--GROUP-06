import { Request, Response } from 'express';
import { sql } from '../db.js';

export const getAllStyles = async (req: Request, res: Response) => {
  try {
    const result = await sql.query(`
      SELECT DISTINCT 
        KIEU_DANG
      FROM SAN_PHAM
      WHERE KIEU_DANG IS NOT NULL
      ORDER BY KIEU_DANG
    `);

    res.status(200).json(result.recordset);
  } catch (error: any) {
    res.status(500).json({
      message: 'Lỗi Controller: ' + error.message
    });
  }
};