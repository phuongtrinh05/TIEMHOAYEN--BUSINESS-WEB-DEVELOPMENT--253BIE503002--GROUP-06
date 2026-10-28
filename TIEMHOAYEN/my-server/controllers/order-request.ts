import type { Request, Response, NextFunction } from 'express';
import { getCollection } from '../mongo.js';
import { InventoryError } from '../services/inventory/helpers.js';
import { getPublicRequest, REQUESTS, REQUEST_STATUS, updateSalesRequest } from '../services/order-request.service.js';
import { resolveRoleName } from '../services/role-permission.service.js';
import { requestWorkflow } from '../services/request-workflow.js';
import { accessToken } from './order-access.js';
import { consultationOptions, convertProposal, messages, propose, respondToProposal, sendMessage, recordContact, customerChangeRequest } from '../services/sales-proposal.service.js';

const failure = (res: Response, error: any) => res.status(error instanceof InventoryError ? error.status : 500)
  .json({ message: error instanceof InventoryError ? error.message : 'Không thể xử lý yêu cầu đặt hàng.' });

// Use the persisted employee role, never a claimed x-admin-role for this queue.
export async function requireSales(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.headers['x-admin-id'] || '');
    const employee = id ? await (await getCollection<any>('NHAN_VIEN')).findOne({ NHAN_VIEN_ID: id }) : null;
    if (!employee || !['Admin', 'Nhân viên bán hàng'].includes(resolveRoleName(employee.VAI_TRO)) || /khóa|ngừng|ngưng|nghỉ|inactive/i.test(String(employee.TRANG_THAI || ''))) {
      return res.status(403).json({ message: 'Chỉ nhân viên Sales hoặc Admin đang hoạt động được xử lý yêu cầu.' });
    }
    res.locals.salesEmployee = employee;
    next();
  } catch (error) { failure(res, error); }
}

export async function listRequests(req: Request, res: Response) {
  try {
    const status = String(req.query.status || '');
    if (status && !Object.values(REQUEST_STATUS).includes(status as any)) throw new InventoryError(400, 'Trạng thái không hợp lệ.');
    const requestedPage = Number(req.query.page);
    const page = Number.isFinite(requestedPage) ? Math.min(1000000, Math.max(1, Math.floor(requestedPage || 1))) : 1;
    const col = await getCollection<any>(REQUESTS);
    const query = status ? { status } : {};
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    // Rank before pagination: older urgent requests must not disappear behind newer scheduled ones.
    const [requests, total] = await Promise.all([
      col.aggregate([
        { $match: query },
        { $set: { _deliveryDate: { $ifNull: ['$quote.delivery.date', '$delivery.date'] } } },
        { $set: { _parsedDate: { $dateFromString: { dateString: '$_deliveryDate', format: { $cond: [{ $regexMatch: { input: { $ifNull: ['$_deliveryDate', ''] }, regex: /^\d{2}\// } }, '%d/%m/%Y', '%Y-%m-%d'] }, timezone: 'Asia/Ho_Chi_Minh', onError: null, onNull: null } } } },
        { $set: { _priority: { $cond: [{ $in: ['$status', [REQUEST_STATUS.converted, REQUEST_STATUS.rejected, REQUEST_STATUS.closed, REQUEST_STATUS.cancelled]] }, 2,
          { $cond: [{ $and: [{ $ne: ['$_parsedDate', null] }, { $lt: ['$_parsedDate', new Date(new Date(`${today}T00:00:00+07:00`).getTime() + 86400000)] }] }, 0, 1] }] } } },
        { $sort: { _priority: 1, followUpAt: 1, _parsedDate: 1, createdAt: 1 } },
        { $skip: (page - 1) * 20 }, { $limit: 20 },
        { $project: { tokenHash: 0, _deliveryDate: 0, _parsedDate: 0, _priority: 0 } },
      ]).toArray(), col.countDocuments(query),
    ]);
    const enriched = requests.map(row => ({ ...row, workflow: requestWorkflow(row) }));
    enriched.sort((a,b) => Number(b.workflow.urgency === 'urgent') - Number(a.workflow.urgency === 'urgent'));
    res.json({ requests: enriched, total, page });
  } catch (error) { failure(res, error); }
}
export async function changeRequest(req: Request, res: Response) {
  try {
    const row = await updateSalesRequest(String(req.params.requestId), req.body, res.locals.salesEmployee);
    const { tokenHash, ...safe } = row;
    res.json(safe);
  } catch (error) { failure(res, error); }
}
export async function readPublicRequest(req: Request, res: Response) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getPublicRequest(String(req.params.requestId), accessToken(req)));
  } catch (error) { failure(res, error); }
}

export async function salesOptions(req: Request, res: Response) {
  try { res.json(await consultationOptions(String(req.params.requestId), String(req.query.search || ''), res.locals.salesEmployee)); }
  catch (error) { failure(res, error); }
}
export async function salesPropose(req: Request, res: Response) {
  try { res.json(await propose(String(req.params.requestId), req.body, res.locals.salesEmployee)); }
  catch (error) { failure(res, error); }
}
export async function salesConvert(req: Request, res: Response) {
  try { res.json(await convertProposal(String(req.params.requestId), req.body, res.locals.salesEmployee)); }
  catch (error) { failure(res, error); }
}
export async function customerRespond(req: Request, res: Response) {
  try { res.json(await respondToProposal(String(req.params.requestId), accessToken(req), req.body)); }
  catch (error) { failure(res, error); }
}
export async function salesRecordContact(req: Request, res: Response) {
  try { res.json(await recordContact(String(req.params.requestId), req.body, res.locals.salesEmployee)); }
  catch (error) { failure(res, error); }
}
export async function customerUpdateRequest(req: Request, res: Response) {
  try { res.json(await customerChangeRequest(String(req.params.requestId), accessToken(req), req.body)); }
  catch (error) { failure(res, error); }
}
const participant = (req: Request, res: Response) => ({ token: accessToken(req), employee: res.locals.salesEmployee });
export async function listRequestMessages(req: Request, res: Response) {
  try { res.setHeader('Cache-Control', 'no-store'); res.json(await messages(String(req.params.requestId), participant(req, res))); }
  catch (error) { failure(res, error); }
}
export async function postRequestMessage(req: Request, res: Response) {
  try { res.status(201).json(await sendMessage(String(req.params.requestId), req.body, participant(req, res))); }
  catch (error) { failure(res, error); }
}
export async function requireRequestOwner(req: Request, res: Response, next: NextFunction) {
  try {
    const row = await (await getCollection<any>(REQUESTS)).findOne({ _id: String(req.params.requestId), assignedTo: res.locals.salesEmployee.NHAN_VIEN_ID });
    if (!row) throw new InventoryError(403, 'Bạn chưa tiếp nhận yêu cầu này.');
    next();
  } catch (error) { failure(res, error); }
}
export function uploadedProposalImage(req: Request, res: Response) {
  if (!req.file) return res.status(400).json({ message: 'Chọn ảnh JPG, PNG, WEBP hoặc GIF.' });
  const origin = String(process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return res.status(201).json({ url: `${origin}/uploads/materials/${req.file.filename}` });
}
