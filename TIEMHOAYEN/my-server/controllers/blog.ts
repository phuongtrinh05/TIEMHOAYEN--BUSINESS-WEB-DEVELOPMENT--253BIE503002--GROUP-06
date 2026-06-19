import { Request, Response } from 'express';
import { sql } from '../db.js';

export const getAllBlogs = async (req: Request, res: Response) => {
    try {
        const result = await sql.query('SELECT * FROM BAI_VIET');
        res.status(200).json(result.recordset);
    } catch (error: any) {
        res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
    }
};
export const getBlogById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await sql.query`SELECT * FROM BAI_VIET WHERE BAI_VIET_ID = ${id}`;

        if (result.recordset.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy bài viết' });
        }

        res.status(200).json(result.recordset[0]);
    } catch (error: any) {
        res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
    }
};