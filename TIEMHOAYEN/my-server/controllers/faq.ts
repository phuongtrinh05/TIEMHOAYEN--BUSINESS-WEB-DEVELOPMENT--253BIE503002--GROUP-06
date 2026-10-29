import { Request, Response } from 'express';
import { getCollection } from '../mongo.js';
import { randomBytes } from 'node:crypto';
import { InventoryError } from '../services/inventory/helpers.js';

const DEFAULT_FAQ_STATUS = 'Bị khóa';
const canonicalQuestion=(s:unknown)=>String(s||'').normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('vi');
async function validateFaq(body:any,id='') {
  const {question,answer,category}=body; const status=body.status||DEFAULT_FAQ_STATUS;
  if(!String(question||'').trim()||!String(answer||'').trim()||!String(category||'').trim())throw new InventoryError(400,'Câu hỏi, câu trả lời và danh mục là bắt buộc.');
  if(String(question).trim().length>1000||String(answer).trim().length>8000||String(category).trim().length>100)throw new InventoryError(400,'Nội dung FAQ vượt độ dài cho phép.');
  if(!['Hoạt động','Bị khóa'].includes(status))throw new InventoryError(400,'Trạng thái câu hỏi không hợp lệ.');
  const rows=await (await getFAQCollection()).find({CAU_HOI_ID:{$ne:id}},{projection:{CAU_HOI:1}}).toArray();
  if(rows.some(r=>canonicalQuestion(r.CAU_HOI)===canonicalQuestion(question)))throw new InventoryError(409,'Câu hỏi đã tồn tại.');
  return canonicalQuestion(question);
}

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
    const [faqs,usage] = await Promise.all([
      collection.find({}).toArray(),
      (await getCollection('TIN_NHAN_CHAT')).aggregate([{$match:{CAU_HOI_ID:{$type:'string'},LOAI_TIN_NHAN:{$ne:'test'}}},{$group:{_id:'$CAU_HOI_ID',count:{$sum:1}}}]).toArray(),
    ]);
    const counts=new Map(usage.map(r=>[r._id,r.count]));
    return res.status(200).json(faqs.sort(sortFAQ).map(f=>({...f,SO_LUOT_HOI:counts.get(f.CAU_HOI_ID)||0})));
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
    const normalized=await validateFaq(req.body);
    const faqId = `CH${randomBytes(4).toString('hex').toUpperCase()}`;
    const faq = {
      CAU_HOI_ID: faqId,
      CAU_HOI: String(question).trim(),
      CAU_HOI_CHUAN: normalized,
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
    if(error instanceof InventoryError)return res.status(error.status).json({message:error.message});
    if(error.code===11000)return res.status(409).json({message:'Câu hỏi đã tồn tại.'});
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
    const normalized=await validateFaq(req.body,String(id));
    await collection.updateOne(
      { CAU_HOI_ID: id },
      {
        $set: {
          CAU_HOI: String(question).trim(),
          CAU_HOI_CHUAN: normalized,
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
    if(error instanceof InventoryError)return res.status(error.status).json({message:error.message});
    if(error.code===11000)return res.status(409).json({message:'Câu hỏi đã tồn tại.'});
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
