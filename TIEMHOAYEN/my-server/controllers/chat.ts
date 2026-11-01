import { Request, Response } from 'express';
import axios from 'axios';
import { getCollection, getNextPrefixedId } from '../mongo.js';

const N8N_WEBHOOK_URL = 'https://thuongthu.app.n8n.cloud/webhook/2bb78087-b702-4dc2-91d4-12b65ef2dc79';
const CHAT_PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const GENERATED_IMAGE_REPLY = 'Đây là bó hoa mình tạo cho bạn';

const toNullableString = (value: unknown): string | null => {
  const text = String(value ?? '').trim();
  return text ? text : null;
};

const buildGuestContactBlock = (name: unknown, phone: unknown, email: unknown): string => {
  const parts = [
    toNullableString(name) ? `Tên khách: ${toNullableString(name)}` : '',
    toNullableString(phone) ? `SĐT khách: ${toNullableString(phone)}` : '',
    toNullableString(email) ? `Email khách: ${toNullableString(email)}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? `[Thông tin khách vãng lai] ${parts.join(' | ')}\n` : '';
};

const normalizeChatImageUrl = (row: any): string | null => {
  const image = toNullableString(row.HINH_ANH);
  if (!image) return null;
  if (/^https?:\/\//i.test(image)) return image;
  if (image.startsWith('data:')) return `${CHAT_PUBLIC_BASE_URL}/api/chats/image/${row.TIN_NHAN_ID}`;
  return image;
};

const extractImageFromReply = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^https?:\/\/.+\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(text)) return text;
    if (text.startsWith('data:image/')) return text;
    return null;
  }
  if (typeof value !== 'object') return null;
  const objectValue = value as Record<string, any>;
  return (
    extractImageFromReply(objectValue.imageUrl) ||
    extractImageFromReply(objectValue.image) ||
    extractImageFromReply(objectValue.url) ||
    extractImageFromReply(objectValue.output)
  );
};

const extractTextFromReply = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractTextFromReply).find(Boolean) || '';
  if (typeof value === 'object') {
    const objectValue = value as Record<string, any>;
    return String(
      objectValue.reply ||
      objectValue.answer ||
      objectValue.message ||
      objectValue.text ||
      objectValue.output ||
      '',
    ).trim();
  }
  return '';
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

export const saveHandoffChat = async (req: Request, res: Response) => {
  try {
    const {
      chatInput,
      customerId,
      productId,
      orderId,
      image,
      imageDataUrl,
      imageName,
      imageType,
      guestName,
      guestPhone,
      guestEmail,
    } = req.body;
    const question = toNullableString(chatInput);
    const attachedImage = toNullableString(imageDataUrl || image?.dataUrl);
    const normalizedCustomerId = toNullableString(customerId);
    const guestContactBlock = normalizedCustomerId ? '' : buildGuestContactBlock(guestName, guestPhone, guestEmail);
    const storedQuestion = `${guestContactBlock}${question || 'Khách hàng đã gửi hình ảnh'}`;

    if (!question && !attachedImage) {
      return res.status(400).json({ message: 'Thiếu nội dung tin nhắn hoặc hình ảnh.' });
    }

    const chatId = await createChatId();
    await (await getChatCollection()).insertOne({
      _id: chatId,
      TIN_NHAN_ID: chatId,
      KHACH_HANG_ID: normalizedCustomerId,
      DON_HANG_ID: toNullableString(orderId),
      SAN_PHAM_ID: toNullableString(productId),
      NHAN_VIEN_ID: null,
      CAU_HOI_ID: null,
      YEU_CAU_ID: null,
      NOI_DUNG_CAU_HOI: storedQuestion,
      NOI_DUNG_TRA_LOI: null,
      LOAI_TIN_NHAN: 'human_request',
      THOI_GIAN_GUI: new Date(),
      TRANG_THAI: 'pending',
      HINH_ANH: attachedImage,
      TEN_FILE_ANH: toNullableString(imageName || image?.name),
      LOAI_FILE_ANH: toNullableString(imageType || image?.type),
    });

    return res.status(201).json({
      message: 'Đã chuyển yêu cầu cho nhân viên.',
      chatId,
      imageSaved: Boolean(attachedImage),
    });
  } catch (error: any) {
    console.error('SAVE HANDOFF CHAT ERROR:', error);
    return res.status(500).json({ message: 'Không thể lưu yêu cầu chat.' });
  }
};

export const getAdminChatConversations = async (_req: Request, res: Response) => {
  try {
    const [chatCollection, customerCollection, productCollection] = await Promise.all([
      getChatCollection(),
      getCollection<any>('KHACH_HANG'),
      getCollection<any>('SAN_PHAM'),
    ]);
    const rows = (await chatCollection.find({}).toArray()).sort(sortChats);
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
    const rows = (await (await getChatCollection()).find({ KHACH_HANG_ID: customerId }).toArray()).sort(sortChats);
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

    if (!seed) {
      return res.status(404).json({ message: 'Không tìm thấy hội thoại.' });
    }

    const query = seed.KHACH_HANG_ID
      ? { KHACH_HANG_ID: seed.KHACH_HANG_ID }
      : seed.DON_HANG_ID
        ? { DON_HANG_ID: seed.DON_HANG_ID, KHACH_HANG_ID: null }
        : { TIN_NHAN_ID: chatId };
    const rows = (await chatCollection.find(query).toArray()).sort(sortChats);

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
    const { reply, employeeId, staffId, image, imageDataUrl, imageName, imageType, chatId } = req.body;
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

    await chatCollection.updateOne(
      { TIN_NHAN_ID: target.TIN_NHAN_ID },
      { $set: { TRANG_THAI: 'completed', NHAN_VIEN_ID: employeeId || staffId || null } },
    );

    const newChatId = await createChatId();
    const replyRow = {
      _id: newChatId,
      TIN_NHAN_ID: newChatId,
      KHACH_HANG_ID: target.KHACH_HANG_ID || null,
      DON_HANG_ID: target.DON_HANG_ID || null,
      SAN_PHAM_ID: target.SAN_PHAM_ID || null,
      NHAN_VIEN_ID: employeeId || staffId || null,
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

export const sendChat = async (req: Request, res: Response) => {
  try {
    const {
      chatInput,
      customerId,
      productId,
      orderId,
      image,
      imageDataUrl,
      imageName,
      imageType,
      guestName,
      guestPhone,
      guestEmail,
    } = req.body;
    const chatText = String(chatInput || '').trim();
    const attachedImage = toNullableString(imageDataUrl || image?.dataUrl);

    if (!chatText && !attachedImage) {
      return res.status(400).json({ message: 'Thiếu nội dung chat.' });
    }

    let webhookResponse: any = null;
    try {
      const response = await axios.post(N8N_WEBHOOK_URL, req.body, { timeout: 20_000 });
      webhookResponse = response.data;
    } catch (error: any) {
      webhookResponse = {
        reply: 'Mình đã ghi nhận tin nhắn của bạn. Nhân viên Tiệm Hoa Yên sẽ hỗ trợ thêm nếu cần.',
      };
    }

    const imageReply = extractImageFromReply(webhookResponse);
    const textReply = extractTextFromReply(webhookResponse) || (imageReply ? GENERATED_IMAGE_REPLY : 'Tiệm Hoa Yên đã nhận tin nhắn của bạn.');
    const messageType = imageReply ? 'image_generation' : 'bot_reply';
    const normalizedCustomerId = toNullableString(customerId);
    const guestContactBlock = normalizedCustomerId ? '' : buildGuestContactBlock(guestName, guestPhone, guestEmail);
    const chatId = await createChatId();
    const row = {
      _id: chatId,
      TIN_NHAN_ID: chatId,
      KHACH_HANG_ID: normalizedCustomerId,
      DON_HANG_ID: toNullableString(orderId),
      SAN_PHAM_ID: toNullableString(productId),
      NHAN_VIEN_ID: null,
      CAU_HOI_ID: null,
      YEU_CAU_ID: null,
      NOI_DUNG_CAU_HOI: `${guestContactBlock}${chatText || 'Khách hàng đã gửi hình ảnh'}`,
      NOI_DUNG_TRA_LOI: textReply,
      LOAI_TIN_NHAN: messageType,
      THOI_GIAN_GUI: new Date(),
      TRANG_THAI: 'completed',
      HINH_ANH: imageReply || attachedImage,
      TEN_FILE_ANH: imageReply ? 'chatbot-image' : toNullableString(imageName || image?.name),
      LOAI_FILE_ANH: imageReply ? 'image/web' : toNullableString(imageType || image?.type),
    };
    await (await getChatCollection()).insertOne(row);

    return res.status(200).json({
      reply: textReply,
      answer: textReply,
      imageUrl: imageReply,
      chatId,
      message: mapChatRow(row),
      raw: webhookResponse,
    });
  } catch (error: any) {
    console.error('SEND CHAT ERROR:', error);
    return res.status(500).json({ message: 'Không thể gửi chat.' });
  }
};
