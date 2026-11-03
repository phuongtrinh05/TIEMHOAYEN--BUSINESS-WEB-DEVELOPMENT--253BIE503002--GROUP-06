import type { ClientSession } from 'mongodb';
import { ceilQty, roundQty, InventoryError,col } from './inventory/helpers.js';
import { reserveMaterialNeeds, reserveProducts, type ReserveContext } from './inventory/stock.service.js';

/** Custom bouquets use their agreed material snapshot, never the catalog BOM. All lines share one transaction. */
export async function reserveOrderLines(session: ClientSession, items: any[], context: ReserveContext) {
  const usesMaterialSnapshot = (item: any) => item.custom || item.bom?.useMaterialSnapshot === true;
  const catalog = items.filter(item => !usesMaterialSnapshot(item)).map(item => ({ productId: item.id, quantity: item.qty }));
  if (catalog.length) await reserveProducts(catalog, context, session);
  const needs = new Map<string, number>();
  for (const item of items.filter(usesMaterialSnapshot)) {
    for (const line of item.bom.materials) {
      needs.set(line.materialId, roundQty((needs.get(line.materialId) || 0) + ceilQty(line.quantity * item.qty)));
    }
  }
  if (needs.size) await reserveMaterialNeeds(session, needs, context);
  for(const item of items.filter(item=>item.custom&&String(item.id).startsWith('SPGIFT_'))){
    const giftNeeds=new Map<string,number>();for(const l of item.bom.materials)giftNeeds.set(l.materialId,ceilQty(l.quantity*item.qty));
    const holds=await reserveMaterialNeeds(session,giftNeeds,context);
    await (await col('GIU_TON')).updateMany({_id:{$in:holds.map(h=>h._id)}},{$set:{VQ_PHAN_THUONG_ID:String(item.id).slice(7)}},{session});
  }
}
