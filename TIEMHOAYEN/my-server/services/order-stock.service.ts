import type { ClientSession } from 'mongodb';
import { ceilQty, roundQty } from './inventory/helpers.js';
import { reserveMaterialNeeds, reserveProducts, type ReserveContext } from './inventory/stock.service.js';

/** Custom bouquets use their agreed material snapshot, never the catalog BOM. All lines share one transaction. */
export async function reserveOrderLines(session: ClientSession, items: any[], context: ReserveContext) {
  const catalog = items.filter(item => !item.custom).map(item => ({ productId: item.id, quantity: item.qty }));
  if (catalog.length) await reserveProducts(catalog, context, session);
  const needs = new Map<string, number>();
  for (const item of items.filter(item => item.custom)) {
    for (const line of item.bom.materials) {
      needs.set(line.materialId, roundQty((needs.get(line.materialId) || 0) + ceilQty(line.quantity * item.qty)));
    }
  }
  if (needs.size) await reserveMaterialNeeds(session, needs, context);
}
