import type { Request, Response, NextFunction } from 'express';
import { getCollection } from '../mongo.js';
import { InventoryError } from '../services/inventory/helpers.js';
import { getPublicRequest, REQUESTS, REQUEST_STATUS, updateSalesRequest } from '../services/order-request.service.js';
import { resolveRoleName } from '../services/role-permission.service.js';
import { requestWorkflow } from '../services/request-workflow.js';
import { accessToken } from './order-access.js';
import { consultationOptions, confirmOriginalRequest, convertProposal, messages, propose, respondToProposal, sendMessage, recordContact, customerChangeRequest } from '../services/sales-proposal.service.js';
import { authenticatedEmployee } from '../middleware/rolePermission.js';

const failure = (res: Response, error: any) => res.status(error instanceof InventoryError ? error.status : 500)
  .json({ message: error instanceof InventoryError ? error.message : 'Không thể xử lý yêu cầu đặt hàng.' });

// Use the persisted employee role, never a claimed x-admin-role for this queue.
export async function requireSales(req: Request, res: Response, next: NextFunction) {
  try {
    const employee = await authenticatedEmployee(req);
    if (!employee || !['Admin', 'Nhân viên bán hàng'].includes(resolveRoleName(employee.VAI_TRO)) || /khóa|ngừng|ngưng|nghỉ|inactive/i.test(String(employee.TRANG_THAI || ''))) {
      return res.status(403).json({ message: 'Chỉ nhân viên Sales hoặc Admin đang hoạt động được xử lý yêu cầu.' });
    }
    res.locals.salesEmployee = employee;
    res.locals.adminEmployee = employee;
    next();
  } catch (error) { failure(res, error); }
}

export async function listRequests(req: Request, res: Response) {
  try {
    const status = String(req.query.status || '');
    if (status && !Object.values(REQUEST_STATUS).includes(status as any)) throw new InventoryError(400, 'Trạng thái không hợp lệ.');
    const search = String(req.query.search || '').trim().slice(0, 100);
    const requestedPage = Number(req.query.page);
    const page = Number.isFinite(requestedPage) ? Math.min(1000000, Math.max(1, Math.floor(requestedPage || 1))) : 1;
    const col = await getCollection<any>(REQUESTS);
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchQuery = search ? { $or: [
      { requestId: { $regex: escapedSearch, $options: 'i' } },
      { orderId: { $regex: escapedSearch, $options: 'i' } },
      { 'sender.name': { $regex: escapedSearch, $options: 'i' } },
      { 'items.name': { $regex: escapedSearch, $options: 'i' } },
      { 'quote.items.name': { $regex: escapedSearch, $options: 'i' } },
    ] } : {};
    const statusQuery = status ? { status: status === REQUEST_STATUS.pendingPayment
      ? { $in: [REQUEST_STATUS.pendingPayment, 'Chờ thanh toán'] }
      : status === REQUEST_STATUS.processing
        ? { $in: [REQUEST_STATUS.processing, REQUEST_STATUS.accepted] }
        : status } : {};
    const query = { ...statusQuery, ...searchQuery };
    // The queue used to download every complete request (quote history, checkout
    // snapshots, conversation metadata...) before slicing 20 rows. Atlas latency
    // made the empty/loading screen unnecessarily long. Read only the fields
    // required for priority ordering first, then hydrate the current page.
    const queueProjection = {
      _id: 1, requestId: 1, status: 1, createdAt: 1, followUpAt: 1, contactStatus: 1,
      delivery: 1, 'items.quantity': 1, 'quote.delivery': 1, 'quote.items.qty': 1,
    };
    const allRequests = await col.find(query, { projection: queueProjection }).toArray();
    const total = allRequests.length;
    const summaryRows = status
      ? await col.find(searchQuery, { projection: queueProjection }).toArray()
      : allRequests;
    // Waiting for payment is still an active Sales request. Keep it visible to
    // both Admin and Customer until payment succeeds or the deadline expires.
    const closed = new Set([REQUEST_STATUS.converted, REQUEST_STATUS.rejected, REQUEST_STATUS.closed, REQUEST_STATUS.cancelled, REQUEST_STATUS.expired]);
    const excludedFromUrgentCount = new Set([...closed, REQUEST_STATUS.pendingPayment]);
    const normalizeQueueStatus = (row: any) => row.status === 'Chờ thanh toán'
      ? { ...row, status: REQUEST_STATUS.pendingPayment }
      // `Khách đã đồng ý` was an old short-lived technical state between
      // acceptance and atomic order creation. It is no longer an Admin-facing
      // workflow state; a stranded legacy row returns to Sales processing.
      : row.status === REQUEST_STATUS.accepted ? { ...row, status: REQUEST_STATUS.processing } : row;
    const prioritized = allRequests.map(row => {
      const normalized = normalizeQueueStatus(row);
      return { ...normalized, workflow: requestWorkflow(normalized) };
    }).sort((a: any, b: any) => {
      const closedRank = (row: any) => closed.has(row.status) ? 1 : 0;
      const followUp = (row: any) => row.followUpAt ? new Date(row.followUpAt).getTime() : Number.MAX_SAFE_INTEGER;
      // A past appointment is no longer an actionable priority. Keep those
      // requests in the normal group and do not let an old date push them above
      // upcoming requests.
      const delivery = (row: any) => row.workflow.deliveryAt && !row.workflow.scheduleExpired
        ? new Date(row.workflow.deliveryAt).getTime() : Number.MAX_SAFE_INTEGER;
      return closedRank(a) - closedRank(b)
        || Number(a.workflow.severityRank) - Number(b.workflow.severityRank)
        || followUp(a) - followUp(b)
        || delivery(a) - delivery(b)
        || new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    });
    const pagePriorityRows = prioritized.slice((page - 1) * 20, page * 20);
    const pageIds = pagePriorityRows.map((row: any) => row._id);
    const pageDocuments = pageIds.length
      ? await col.find({ _id: { $in: pageIds } }, { projection: { tokenHash: 0, quoteHistory: 0, checkoutData: 0 } }).toArray()
      : [];
    const pageById = new Map(pageDocuments.map((row: any) => [String(row._id), row]));
    const enriched = pagePriorityRows.map((priorityRow: any) => {
      const document = pageById.get(String(priorityRow._id)) || priorityRow;
      const normalized = normalizeQueueStatus(document);
      return { ...normalized, workflow: priorityRow.workflow };
    });
    const summaryEnriched = status ? summaryRows.map((row: any) => {
      const normalized = normalizeQueueStatus(row);
      return { ...normalized, workflow: requestWorkflow(normalized) };
    }) : prioritized;
    const activeRows = summaryEnriched.filter((row: any) => !excludedFromUrgentCount.has(row.status));
    res.json({ requests: enriched, total, page,
      summary: {
        total: summaryEnriched.length,
        waiting: summaryEnriched.filter((row: any) => row.status === REQUEST_STATUS.waiting).length,
        urgent: activeRows.filter((row: any) => row.workflow.urgency === 'urgent').length,
      },
    });
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
  try { res.json(await consultationOptions(String(req.params.requestId), String(req.query.search || ''), res.locals.salesEmployee,
    String(req.query.includeCatalog || '') === 'true', String(req.query.includeSources || '') === 'true')); }
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
export async function salesConfirmOriginal(req: Request, res: Response) {
  try { res.json(await confirmOriginalRequest(String(req.params.requestId), req.body, res.locals.salesEmployee)); }
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
