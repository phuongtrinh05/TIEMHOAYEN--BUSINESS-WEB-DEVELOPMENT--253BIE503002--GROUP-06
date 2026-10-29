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
    readonly opened = new Subject<SupportSession>();
    get session(): SupportSession | null {
        try {
            const s = JSON.parse(sessionStorage.getItem('tiemHoaYenSupportSession') || 'null');
            return s?.ticketId && s.accountKey === currentOrderAccountKey() ? s : null;
        }
        catch {
            return null;
        }
    }
    save(value: any, open = false) {
        const session: SupportSession = { ticketId: value.ticket?.id || value.ticketId, guestToken: value.guestToken, expiresAt: value.expiresAt, accountKey: currentOrderAccountKey() };
        sessionStorage.setItem('tiemHoaYenSupportSession', JSON.stringify(session));
        if (open)
            this.opened.next(session);
        return session;
    }
    clear() { sessionStorage.removeItem('tiemHoaYenSupportSession'); }
}
