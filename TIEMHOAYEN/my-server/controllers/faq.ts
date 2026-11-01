import { Request, Response } from 'express';
import { getCollection, getNextPrefixedId } from '../mongo.js';

const DEFAULT_FAQ_STATUS = 'Hoạt động';

const getFAQCollection = () => getCollection('CAU_HOI_CO_SAN');

const sortFAQ = (left: any, right: any): number => {
  const leftNumber = Number(String(left.CAU_HOI_ID || '').replace('CH', ''));
  const rightNumber = Number(String(right.CAU_HOI_ID || '').replace('CH', ''));
  if (leftNumber !== rightNumber) return leftNumber - rightNumber;
  return String(left.CAU_HOI_ID || '').localeCompare(String(right.CAU_HOI_ID || ''), 'vi');
};

export const getAllFAQs = async (_req: Request, res: Response) => {
  try {
    const collection = await getFAQCollection();
    const faqs = await collection.find({}).toArray();
    return res.status(200).json(faqs.sort(sortFAQ));
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot load FAQs: ' + error.message });
  }
};

export const getFAQById = async (req: Request, res: Response) => {
  try {
    const collection = await getFAQCollection();
    const faq = await collection.findOne({ CAU_HOI_ID: req.params.id });

    if (!faq) {
      return res.status(404).json({ message: 'Không tìm thấy câu hỏi.' });
    }

    return res.status(200).json(faq);
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

    const collection = await getFAQCollection();
    const faqId = await getNextPrefixedId('CAU_HOI_CO_SAN', 'CAU_HOI_ID', 'CH', 3);
    const faq = {
      CAU_HOI_ID: faqId,
      CAU_HOI: String(question).trim(),
      CAU_TRA_LOI: String(answer).trim(),
      DANH_MUC_CAU_HOI: String(category).trim(),
      TRANG_THAI: String(status || DEFAULT_FAQ_STATUS).trim(),
    };

    await collection.insertOne(faq);

    return res.status(201).json({
      message: 'FAQ created.',
      faq,
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

    const collection = await getFAQCollection();
    await collection.updateOne(
      { CAU_HOI_ID: id },
      {
        $set: {
          CAU_HOI: String(question).trim(),
          CAU_TRA_LOI: String(answer).trim(),
          DANH_MUC_CAU_HOI: String(category).trim(),
          TRANG_THAI: String(status || DEFAULT_FAQ_STATUS).trim(),
        },
      },
    );
    const faq = await collection.findOne({ CAU_HOI_ID: id });

    if (!faq) {
      return res.status(404).json({ message: 'Không tìm thấy câu hỏi.' });
    }

    return res.status(200).json({
      message: 'FAQ updated.',
      faq,
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

    const collection = await getFAQCollection();
    const result = await collection.deleteOne({ CAU_HOI_ID: id });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Không tìm thấy câu hỏi.' });
    }

    return res.status(200).json({ message: 'FAQ deleted.' });
  } catch (error: any) {
    return res.status(500).json({ message: 'Cannot delete FAQ: ' + error.message });
  }
};
