import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { currentOrderAccountKey } from './api-config';
export interface SupportSession {
    ticketId: string;
    guestToken?: string;
    accountKey: string;
    expiresAt?: string;
}
@Injectable({ providedIn: 'root' })
export class SupportChatService {
    private readonly storageKey = 'tiemHoaYenSupportSession';
    readonly opened = new Subject<SupportSession>();
    get session(): SupportSession | null {
        try {
            const s = JSON.parse(localStorage.getItem(this.storageKey) || 'null');
            const expired = s?.expiresAt && new Date(s.expiresAt).getTime() <= Date.now();
            if (!s?.ticketId || s.accountKey !== currentOrderAccountKey() || expired) {
                if (expired)
                    localStorage.removeItem(this.storageKey);
                return null;
            }
            return s;
        }
        catch {
            return null;
        }
    }
    save(value: any, open = false) {
        const session: SupportSession = { ticketId: value.ticket?.id || value.ticketId, guestToken: value.guestToken, expiresAt: value.expiresAt, accountKey: currentOrderAccountKey() };
        localStorage.setItem(this.storageKey, JSON.stringify(session));
        if (open)
            this.opened.next(session);
        return session;
    }
    clear() { localStorage.removeItem(this.storageKey); }
}
