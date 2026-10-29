import { Request, Response } from 'express';
import { getCollection, getNextPrefixedId } from '../mongo.js';
import { SALES_CHAT_TYPES } from '../services/sales-proposal.service.js';


const toNullableString = (value: unknown): string | null => {
  const text = String(value ?? '').trim();
  return text ? text : null;
};


const normalizeChatImageUrl = (row: any): string | null => {
  const image = toNullableString(row.HINH_ANH);
  if (!image) return null;
  if (/^https?:\/\//i.test(image)) return image;
  return image;
};



const getChatCollection = () => getCollection<any>('TIN_NHAN_CHAT');

const createChatId = async () => getNextPrefixedId('TIN_NHAN_CHAT', 'TIN_NHAN_ID', 'CHAT', 6);

const mapChatRow = (row: any) => {
  const imageUrl = normalizeChatImageUrl(row);
  return {
    id: row.TIN_NHAN_ID,
    chatId: row.TIN_NHAN_ID,
    customerId: row.KHACH_HANG_ID || null,
    orderId: row.DON_HANG_ID || null,
    productId: row.SAN_PHAM_ID || null,
    staffId: row.NHAN_VIEN_ID || null,
    question: row.NOI_DUNG_CAU_HOI || '',
    answer: row.NOI_DUNG_TRA_LOI || '',
    type: row.LOAI_TIN_NHAN || 'bot_reply',
    status: row.TRANG_THAI || 'completed',
    sentAt: row.THOI_GIAN_GUI,
    image: imageUrl,
    imageUrl,
    imageName: row.TEN_FILE_ANH || null,
    imageType: row.LOAI_FILE_ANH || null,
    raw: row,
  };
};

const sortChats = (left: any, right: any) => {
  const dateDiff = new Date(left.THOI_GIAN_GUI || 0).getTime() - new Date(right.THOI_GIAN_GUI || 0).getTime();
  if (dateDiff !== 0) return dateDiff;
  return String(left.TIN_NHAN_ID || '').localeCompare(String(right.TIN_NHAN_ID || ''), 'vi');
};

export const getAdminChatConversations = async (_req: Request, res: Response) => {
  try {
    const [chatCollection, customerCollection, productCollection] = await Promise.all([
      getChatCollection(),
      getCollection<any>('KHACH_HANG'),
      getCollection<any>('SAN_PHAM'),
    ]);
    const rows = (await chatCollection.find({ HO_TRO_ID: { $exists: false }, LOAI_TIN_NHAN: { $nin: SALES_CHAT_TYPES } }).toArray()).sort(sortChats);
    const customerIds = Array.from(new Set(rows.map((row) => row.KHACH_HANG_ID).filter(Boolean)));
    const productIds = Array.from(new Set(rows.map((row) => row.SAN_PHAM_ID).filter(Boolean)));
    const [customers, products] = await Promise.all([
      customerCollection.find({ KHACH_HANG_ID: { $in: customerIds } }).toArray(),
      productCollection.find({ SAN_PHAM_ID: { $in: productIds } }).toArray(),
    ]);
    const customerMap = new Map(customers.map((customer) => [customer.KHACH_HANG_ID, customer]));
    const productMap = new Map(products.map((product) => [product.SAN_PHAM_ID, product]));
    const conversationMap = new Map<string, any>();

    for (const row of rows) {
      const key = row.KHACH_HANG_ID || row.DON_HANG_ID || row.TIN_NHAN_ID;
      if (!conversationMap.has(key)) {
        const customer = customerMap.get(row.KHACH_HANG_ID);
        conversationMap.set(key, {
          id: key,
          conversationId: key,
          customerId: row.KHACH_HANG_ID || null,
          customerName: customer?.TEN || 'Khách vãng lai',
          customerPhone: customer?.SDT || '',
          status: row.TRANG_THAI || 'completed',
          lastMessageAt: row.THOI_GIAN_GUI,
          messages: [],
        });
      }
      const conversation = conversationMap.get(key);
      const product = productMap.get(row.SAN_PHAM_ID);
      conversation.messages.push({
        ...mapChatRow(row),
        productName: product?.TEN_SAN_PHAM || null,
      });
      conversation.lastMessageAt = row.THOI_GIAN_GUI || conversation.lastMessageAt;
      if (row.TRANG_THAI === 'pending') conversation.status = 'pending';
    }

    const conversations = Array.from(conversationMap.values()).sort((left, right) => (
      new Date(right.lastMessageAt || 0).getTime() - new Date(left.lastMessageAt || 0).getTime()
    ));

    return res.status(200).json({
      total: conversations.length,
      conversations,
    });
  } catch (error: any) {
    console.error('ADMIN CHAT ERROR:', error);
    return res.status(500).json({ message: 'Không thể tải hội thoại chat.' });
  }
};

export const getCustomerChatMessages = async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    const rows = (await (await getChatCollection()).find({ KHACH_HANG_ID: customerId, LOAI_TIN_NHAN: { $nin: SALES_CHAT_TYPES } }).toArray()).sort(sortChats);
    return res.status(200).json({
      total: rows.length,
      messages: rows.map(mapChatRow),
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Không thể tải tin nhắn khách hàng.' });
  }
};

export const getChatImage = async (req: Request, res: Response) => {
  try {
    const row = await (await getChatCollection()).findOne({ TIN_NHAN_ID: req.params.chatId });
    const image = toNullableString(row?.HINH_ANH);

    if (!image) {
      return res.status(404).json({ message: 'Không tìm thấy hình ảnh.' });
    }

    if (/^https?:\/\//i.test(image)) {
      return res.redirect(image);
    }

    const match = image.match(/^data:(.+?);base64,(.+)$/);
    if (!match) {
      return res.status(200).send(image);
    }

    res.setHeader('Content-Type', match[1]);
    return res.send(Buffer.from(match[2], 'base64'));
  } catch (error: any) {
    return res.status(500).json({ message: 'Không thể tải hình ảnh chat.' });
  }
};

export const getGuestChatMessages = async (req: Request, res: Response) => {
  try {
    const { chatId } = req.params;
    const chatCollection = await getChatCollection();
    const seed = await chatCollection.findOne({ TIN_NHAN_ID: chatId });

    if (!seed || SALES_CHAT_TYPES.includes(seed.LOAI_TIN_NHAN)) {
      return res.status(404).json({ message: 'Không tìm thấy hội thoại.' });
    }

    const query = seed.KHACH_HANG_ID
      ? { KHACH_HANG_ID: seed.KHACH_HANG_ID }
      : seed.DON_HANG_ID
        ? { DON_HANG_ID: seed.DON_HANG_ID, KHACH_HANG_ID: null }
        : { TIN_NHAN_ID: chatId };
    const rows = (await chatCollection.find({ ...query, LOAI_TIN_NHAN: { $nin: SALES_CHAT_TYPES } }).toArray()).sort(sortChats);

    return res.status(200).json({
      total: rows.length,
      messages: rows.map(mapChatRow),
    });
  } catch (error: any) {
    return res.status(500).json({ message: 'Không thể tải tin nhắn khách vãng lai.' });
  }
};

export const replyAdminChat = async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const { reply, image, imageDataUrl, imageName, imageType, chatId } = req.body;
    const employeeId = res.locals.supportEmployee?.NHAN_VIEN_ID || null;
    const safeReply = String(reply || '').trim();
    const attachedImage = toNullableString(imageDataUrl || image?.dataUrl);

    if (!safeReply && !attachedImage) {
      return res.status(400).json({ message: 'Vui lòng nhập nội dung phản hồi hoặc hình ảnh.' });
    }

    const chatCollection = await getChatCollection();
    const target = chatId
      ? await chatCollection.findOne({ TIN_NHAN_ID: String(chatId) })
      : await chatCollection.findOne({
          $or: [
            { TIN_NHAN_ID: conversationId },
            { KHACH_HANG_ID: conversationId },
            { DON_HANG_ID: conversationId },
          ],
        }, { sort: { THOI_GIAN_GUI: -1 } });

    if (!target) {
      return res.status(404).json({ message: 'Không tìm thấy hội thoại cần phản hồi.' });
    }
    if (target.HO_TRO_ID || SALES_CHAT_TYPES.includes(target.LOAI_TIN_NHAN)) return res.status(403).json({ message: 'Vui lòng phản hồi qua Hộp thư hỗ trợ hoặc Yêu cầu đặt hàng tương ứng.' });

    await chatCollection.updateOne(
      { TIN_NHAN_ID: target.TIN_NHAN_ID },
      { $set: { TRANG_THAI: 'completed', NHAN_VIEN_ID: employeeId } },
    );

    const newChatId = await createChatId();
    const replyRow = {
      _id: newChatId,
      TIN_NHAN_ID: newChatId,
      KHACH_HANG_ID: target.KHACH_HANG_ID || null,
      DON_HANG_ID: target.DON_HANG_ID || null,
      SAN_PHAM_ID: target.SAN_PHAM_ID || null,
      NHAN_VIEN_ID: employeeId,
      CAU_HOI_ID: null,
      YEU_CAU_ID: null,
      NOI_DUNG_CAU_HOI: target.NOI_DUNG_CAU_HOI || '',
      NOI_DUNG_TRA_LOI: safeReply || null,
      LOAI_TIN_NHAN: 'staff_reply',
      THOI_GIAN_GUI: new Date(),
      TRANG_THAI: 'completed',
      HINH_ANH: attachedImage,
      TEN_FILE_ANH: toNullableString(imageName || image?.name),
      LOAI_FILE_ANH: toNullableString(imageType || image?.type),
    };
    await chatCollection.insertOne(replyRow);

    return res.status(201).json({
      message: 'Đã gửi phản hồi.',
      chat: mapChatRow(replyRow),
    });
  } catch (error: any) {
    console.error('REPLY ADMIN CHAT ERROR:', error);
    return res.status(500).json({ message: 'Không thể gửi phản hồi chat.' });
  }
};

export const sendChat = async (_req: Request, res: Response) => res.status(410).json({ message: 'Vui lòng mở phiên chat tại /api/support/sessions để bắt đầu tư vấn.' });
