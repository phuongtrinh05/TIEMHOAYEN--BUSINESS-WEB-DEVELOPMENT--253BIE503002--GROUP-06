import { Request, Response } from 'express';
import { sql } from '../db.js';

export const getAllExportSlips = async (req: Request, res: Response) => {
    try {
        const result = await sql.query('SELECT * FROM PHIEU_XUAT_NVL');
        res.status(200).json(result.recordset);
    } catch (error: any) {
        res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
    }
};
