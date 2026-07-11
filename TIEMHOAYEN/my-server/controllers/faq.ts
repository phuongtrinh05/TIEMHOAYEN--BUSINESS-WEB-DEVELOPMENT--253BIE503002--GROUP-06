import { Request, Response } from 'express';
import { sql } from '../db.js';

const DEFAULT_FAQ_STATUS = 'Hoạt động';

const getFAQSelectQuery = (whereClause = '') => `
    SELECT
        CAU_HOI_ID,
        CAU_HOI,
        CAU_TRA_LOI,
        DANH_MUC_CAU_HOI,
        TRANG_THAI
    FROM CAU_HOI_CO_SAN
    ${whereClause}
`;

const getNextFAQId = async (): Promise<string> => {
    const result = await sql.query`
        SELECT ISNULL(MAX(TRY_CONVERT(INT, REPLACE(CAU_HOI_ID, 'CH', ''))), 0) + 1 AS NEXT_NUM
        FROM CAU_HOI_CO_SAN
        WHERE CAU_HOI_ID LIKE 'CH%'
    `;

    const nextNum = Number(result.recordset[0]?.NEXT_NUM || 1);
    return 'CH' + String(nextNum).padStart(3, '0');
};

export const getAllFAQs = async (_req: Request, res: Response) => {
    try {
        const result = await sql.query(`
            ${getFAQSelectQuery()}
            ORDER BY TRY_CONVERT(INT, REPLACE(CAU_HOI_ID, 'CH', '')) ASC, CAU_HOI_ID ASC
        `);

        return res.status(200).json(result.recordset);
    } catch (error: any) {
        return res.status(500).json({ message: 'Cannot load FAQs: ' + error.message });
    }
};

export const getFAQById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const request = new sql.Request();
        request.input('CAU_HOI_ID', sql.NVarChar(10), id);

        const result = await request.query(`
            ${getFAQSelectQuery('WHERE CAU_HOI_ID = @CAU_HOI_ID')}
        `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy câu hỏi.' });
        }

        return res.status(200).json(result.recordset[0]);
    } catch (error: any) {
        return res.status(500).json({ message: 'Cannot load FAQ: ' + error.message });
    }
};

export const createFAQ = async (req: Request, res: Response) => {
    try {
        const { question, answer, category, status } = req.body;

        if (!String(question || '').trim() || !String(answer || '').trim() || !String(category || '').trim()) {
            return res.status(400).json({ message: 'Thiếu câu hỏi, câu trả lời hoặc danh mục.' });
        }

        const faqId = await getNextFAQId();
        const request = new sql.Request();
        request.input('CAU_HOI_ID', sql.NVarChar(10), faqId);
        request.input('CAU_HOI', sql.NVarChar(500), String(question).trim());
        request.input('CAU_TRA_LOI', sql.NVarChar(sql.MAX), String(answer).trim());
        request.input('DANH_MUC_CAU_HOI', sql.NVarChar(100), String(category).trim());
        request.input('TRANG_THAI', sql.NVarChar(50), String(status || DEFAULT_FAQ_STATUS).trim());

        await request.query(`
            INSERT INTO CAU_HOI_CO_SAN (
                CAU_HOI_ID,
                CAU_HOI,
                CAU_TRA_LOI,
                DANH_MUC_CAU_HOI,
                TRANG_THAI
            )
            VALUES (
                @CAU_HOI_ID,
                @CAU_HOI,
                @CAU_TRA_LOI,
                @DANH_MUC_CAU_HOI,
                @TRANG_THAI
            )
        `);

        const created = await request.query(`
            ${getFAQSelectQuery('WHERE CAU_HOI_ID = @CAU_HOI_ID')}
        `);

        return res.status(201).json({
            message: 'FAQ created.',
            faq: created.recordset[0],
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Cannot create FAQ: ' + error.message });
    }
};

export const updateFAQ = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { question, answer, category, status } = req.body;

        if (!String(id || '').trim() || !String(question || '').trim() || !String(answer || '').trim() || !String(category || '').trim()) {
            return res.status(400).json({ message: 'Thiếu thông tin câu hỏi.' });
        }

        const request = new sql.Request();
        request.input('CAU_HOI_ID', sql.NVarChar(10), id);
        request.input('CAU_HOI', sql.NVarChar(500), String(question).trim());
        request.input('CAU_TRA_LOI', sql.NVarChar(sql.MAX), String(answer).trim());
        request.input('DANH_MUC_CAU_HOI', sql.NVarChar(100), String(category).trim());
        request.input('TRANG_THAI', sql.NVarChar(50), String(status || DEFAULT_FAQ_STATUS).trim());

        const result = await request.query(`
            UPDATE CAU_HOI_CO_SAN
            SET
                CAU_HOI = @CAU_HOI,
                CAU_TRA_LOI = @CAU_TRA_LOI,
                DANH_MUC_CAU_HOI = @DANH_MUC_CAU_HOI,
                TRANG_THAI = @TRANG_THAI
            WHERE CAU_HOI_ID = @CAU_HOI_ID;

            ${getFAQSelectQuery('WHERE CAU_HOI_ID = @CAU_HOI_ID')}
        `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy câu hỏi.' });
        }

        return res.status(200).json({
            message: 'FAQ updated.',
            faq: result.recordset[0],
        });
    } catch (error: any) {
        return res.status(500).json({ message: 'Cannot update FAQ: ' + error.message });
    }
};

export const deleteFAQ = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        if (!String(id || '').trim()) {
            return res.status(400).json({ message: 'Missing FAQ id.' });
        }

        const request = new sql.Request();
        request.input('CAU_HOI_ID', sql.NVarChar(10), id);
        const result = await request.query(`
            DELETE FROM CAU_HOI_CO_SAN
            WHERE CAU_HOI_ID = @CAU_HOI_ID
        `);

        if (result.rowsAffected[0] === 0) {
            return res.status(404).json({ message: 'Không tìm thấy câu hỏi.' });
        }

        return res.status(200).json({ message: 'FAQ deleted.' });
    } catch (error: any) {
        return res.status(500).json({ message: 'Cannot delete FAQ: ' + error.message });
    }
};
