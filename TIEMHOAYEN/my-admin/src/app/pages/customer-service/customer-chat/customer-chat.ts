import { CommonModule } from '@angular/common';
import { AfterViewChecked, ChangeDetectorRef, Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AdminApiService, AdminChatMessage } from '../../../services/admin-api.service';

interface Product {
    id?: string;
    name: string;
    price: number;
    image?: string | null;
}

interface Message {
    id?: string;
    type: 'text' | 'product' | 'date' | 'system' | 'handoff';
    text: string;
    isCustomer?: boolean;
    time?: string;
    status?: string;
    image?: string | null;
    imageName?: string | null;
    imageType?: string | null;
    product?: Product;
}

interface Conversation {
    id: string | number;
    name: string;
    initials: string;
    avatarColor: string;
    customerId: string;
    phone: string;
    isOnline: boolean;
    lastMessage: string;
    unread: number;
    isPending: boolean;
    pendingChatId?: string | null;
    pinnedProduct?: Product;
    messages: Message[];
}

@Component({
    selector: 'app-customer-chat',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive],
    templateUrl: './customer-chat.html',
    styleUrls: ['./customer-chat.css']
})
export class CustomerChatComponent implements OnInit, AfterViewChecked {
    @ViewChild('messageContainer') messageContainer!: ElementRef;
    @ViewChild('replyFileInput') replyFileInput!: ElementRef<HTMLInputElement>;

    searchKeyword = '';
    activeFilter: 'all' | 'pending' = 'all';
    newMessage = '';
    selectedFile: File | null = null;
    selectedImageDataUrl: string | null = null;
    selectedConvId: string | number | null = null;
    selectedConv: Conversation | null = null;
    showListMenu = false;
    showHeaderMenu = false;
    showInfoPanel = false;

    conversations: Conversation[] = [];
    filteredConversations: Conversation[] = [];
    private readonly maxImageSizeBytes = 5 * 1024 * 1024;

    constructor(
        private readonly adminApi: AdminApiService,
        private readonly router: Router,
        private readonly cdr: ChangeDetectorRef
    ) {}

    get pendingCount(): number {
        return this.conversations.filter((conv) => conv.isPending).length;
    }

    ngOnInit(): void {
        this.filteredConversations = [];
        this.selectConversation(null);
        this.loadConversations();
    }

    ngAfterViewChecked(): void {
        this.scrollToBottom();
    }

    toggleInfoPanel(): void {
        this.showInfoPanel = !this.showInfoPanel;
        this.closeQuickMenus();
    }

    toggleListMenu(): void {
        this.showListMenu = !this.showListMenu;
        this.showHeaderMenu = false;
    }

    toggleHeaderMenu(): void {
        this.showHeaderMenu = !this.showHeaderMenu;
        this.showListMenu = false;
    }

    closeQuickMenus(): void {
        this.showListMenu = false;
        this.showHeaderMenu = false;
    }

    canOpenCustomerDetail(conv: Conversation | null): boolean {
        return !!conv?.customerId && conv.customerId.startsWith('CUST');
    }

    openProductDetail(product: Product | null | undefined): void {
        if (!product?.id) return;

        localStorage.setItem('selectedProduct', JSON.stringify({
            sku: product.id,
            code: product.id,
            name: product.name,
            image: product.image || '',
            price: `${Number(product.price || 0).toLocaleString('vi-VN')}đ`,
            rating: 0,
            quantity: 0,
            featured: false,
            sale: false,
            status: ''
        }));
        this.router.navigate(['/products/product-detail'], {
            queryParams: { id: product.id }
        });
    }

    selectConversation(conv: Conversation | null): void {
        if (!conv) {
            this.selectedConvId = null;
            this.selectedConv = null;
            return;
        }

        this.selectedConvId = conv.id;
        this.selectedConv = conv;
        conv.unread = 0;
        this.closeQuickMenus();
    }

    setFilter(filter: 'all' | 'pending'): void {
        this.activeFilter = filter;
        this.filterConversations();
        const stillVisible = this.filteredConversations.find((conv) => conv.id === this.selectedConvId);
        this.selectConversation(stillVisible || this.filteredConversations[0] || null);
    }

    filterConversations(): void {
        const keyword = this.searchKeyword.trim().toLowerCase();

        this.filteredConversations = this.conversations.filter((conv) => {
            const matchesKeyword =
                !keyword ||
                String(conv.name || '').toLowerCase().includes(keyword) ||
                String(conv.customerId || '').toLowerCase().includes(keyword);

            const matchesFilter = this.activeFilter === 'all' || conv.isPending;

            return matchesKeyword && matchesFilter;
        });
    }

    sendMessage(): void {
        if ((!this.newMessage.trim() && !this.selectedImageDataUrl) || !this.selectedConv) return;

        const text = this.newMessage.trim();
        const selectedConv = this.selectedConv;
        const pendingChatId = selectedConv.pendingChatId;
        const imageDataUrl = this.selectedImageDataUrl;
        const imageName = this.selectedFile?.name || null;
        const imageType = this.selectedFile?.type || null;
        const now = new Date();
        const time = `${now.getHours().toString().padStart(2, '0')}:${now
            .getMinutes()
            .toString()
            .padStart(2, '0')}`;

        selectedConv.messages.push({
            type: 'text',
            text,
            isCustomer: false,
            time,
            image: imageDataUrl,
            imageName,
            imageType
        });

        selectedConv.lastMessage = text || 'Ảnh';
        selectedConv.isPending = false;
        selectedConv.pendingChatId = null;
        this.activeFilter = 'all';
        this.newMessage = '';
        this.clearSelectedFile();

        this.adminApi
            .replyChatConversation(String(selectedConv.id), {
                message: text,
                staffId: 'NV001',
                chatId: pendingChatId || null,
                imageDataUrl,
                imageName,
                imageType
            })
            .subscribe({
                next: () => {
                    this.loadConversations();
                },
                error: (error) => {
                    console.error('Khong the luu phan hoi chat:', error);
                    alert('Khong the luu phan hoi chat. Vui long thu lai.');
                    this.loadConversations();
                }
            });
    }

    openFilePicker(): void {
        this.replyFileInput?.nativeElement.click();
    }

    onFileSelected(event: Event): void {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];

        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('Vui lòng chọn file ảnh.');
            input.value = '';
            return;
        }

        if (file.size > this.maxImageSizeBytes) {
            alert('Ảnh quá lớn. Vui lòng chọn ảnh dưới 5MB.');
            input.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            this.selectedFile = file;
            this.selectedImageDataUrl = String(reader.result || '');
        };
        reader.onerror = () => {
            alert('Không đọc được file ảnh. Vui lòng thử lại.');
            this.clearSelectedFile();
        };
        reader.readAsDataURL(file);
        input.value = '';
    }

    clearSelectedFile(): void {
        this.selectedFile = null;
        this.selectedImageDataUrl = null;
    }

    private scrollToBottom(): void {
        try {
            if (this.messageContainer) {
                this.messageContainer.nativeElement.scrollTop =
                    this.messageContainer.nativeElement.scrollHeight;
            }
        } catch {
            // Ignore transient view timing while Angular renders the message list.
        }
    }

    private loadConversations(): void {
        this.adminApi.getChatConversations().subscribe({
            next: (response) => {
                this.conversations = response.conversations.map((conv) => ({
                    ...conv,
                    pinnedProduct: conv.pinnedProduct || undefined,
                    lastMessage: this.isImageUrl(conv.lastMessage) ? 'Ảnh' : conv.lastMessage,
                    messages: conv.messages.map((msg) => this.normalizeMessage(msg))
                }));

                this.filterConversations();
                const current = this.filteredConversations.find((conv) => conv.id === this.selectedConvId);
                this.selectConversation(current || this.filteredConversations[0] || null);
                this.cdr.detectChanges();
            },
            error: (error) => {
                console.error('Khong the tai chat tu backend:', error);
                this.conversations = [];
                this.filteredConversations = [];
                this.selectConversation(null);
            }
        });
    }

    private normalizeMessage(msg: AdminChatMessage): Message {
        const imageFromText = !msg.image && this.isImageUrl(msg.text);

        return {
            ...msg,
            text: imageFromText ? '' : msg.text,
            image: imageFromText ? msg.text.trim() : msg.image,
            imageName: imageFromText ? 'Ảnh trong hội thoại' : msg.imageName,
            product: msg.product || undefined
        };
    }

    private isImageUrl(value: string | null | undefined): boolean {
        const text = (value || '').trim();
        return /^(https?:\/\/\S+\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\?\S*)?|data:image\/[^;]+;base64,\S+)$/i.test(text);
    }
}
