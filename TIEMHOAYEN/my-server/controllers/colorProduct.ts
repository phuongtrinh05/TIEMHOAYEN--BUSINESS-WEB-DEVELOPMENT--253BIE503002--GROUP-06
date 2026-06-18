import { Request, Response } from 'express';
import { sql } from '../db.js';

export const getAllColorProducts = async (req: Request, res: Response) => {
    try {
        const result = await sql.query('SELECT * FROM MAU_SAC_SAN_PHAM');
        res.status(200).json(result.recordset);
    } catch (error: any) {
        res.status(500).json({ message: 'Lỗi Controller: ' + error.message });
    }
};
