import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, ViewChild, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';

import { OrderPolicyComponent } from './order-policy';
import { PaymentPolicyComponent } from './payment-policy';
import { DeliveryPolicyComponent } from './delivery-policy';
import { MembershipPolicyComponent } from './membership-policy';
import { ReturnPolicyComponent } from './return-policy';
import { PrivacyPolicyComponent } from './privacy-policy';
import { CustomerSupportPolicyComponent } from './customer-support-policy';
import { RegistrationTermsConditionsComponent } from './registration-terms-conditions';

interface PolicyNavItem {
    title: string;
    icon: string;
    slug: string;
}

@Component({
    selector: 'app-policy-layout',
    standalone: true,
    imports: [
        CommonModule,
        RouterLink,
        RouterLinkActive,

        OrderPolicyComponent,
        PaymentPolicyComponent,
        DeliveryPolicyComponent,
        MembershipPolicyComponent,
        ReturnPolicyComponent,
        PrivacyPolicyComponent,
        CustomerSupportPolicyComponent,
        RegistrationTermsConditionsComponent
    ],
    templateUrl: './policy-layout.html',
    styleUrls: ['./policy-layout.css'],
    encapsulation: ViewEncapsulation.None
})
export class PolicyLayoutComponent {
    @ViewChild('policyContent') policyContent?: ElementRef<HTMLElement>;

    currentSlug = 'order';
    isHeaderCompact = false;

    policyItems: PolicyNavItem[] = [
        {
            title: 'Chính sách đặt hàng',
            icon: 'bi bi-clipboard-check',
            slug: 'order'
        },
        {
            title: 'Chính sách thanh toán',
            icon: 'bi bi-credit-card',
            slug: 'payment'
        },
        {
            title: 'Chính sách giao hàng',
            icon: 'bi bi-truck',
            slug: 'delivery'
        },
        {
            title: 'Chính sách tích điểm và hạng thành viên',
            icon: 'bi bi-bar-chart',
            slug: 'membership'
        },
        {
            title: 'Chính sách đổi trả, hoàn tiền và huỷ đơn hàng',
            icon: 'bi bi-arrow-counterclockwise',
            slug: 'return'
        },
        {
            title: 'Chính sách bảo mật thông tin',
            icon: 'bi bi-shield-check',
            slug: 'privacy'
        },
        {
            title: 'Chính sách chăm sóc khách hàng',
            icon: 'bi bi-headset',
            slug: 'customer-support'
        },
        {
            title: 'Điều kiện & Điều khoản Đăng ký',
            icon: 'bi bi-file-earmark-text',
            slug: 'registration-terms'
        }
    ];

    constructor(private route: ActivatedRoute) {
        this.route.paramMap.subscribe((params) => {
            this.currentSlug = params.get('slug') || 'order';
            this.updateHeaderCompactState();
            setTimeout(() => this.scrollContentTitleIntoView());
        });
    }

    @HostListener('window:scroll')
    onWindowScroll(): void {
        this.updateHeaderCompactState();
    }

    private updateHeaderCompactState(): void {
        if (typeof window === 'undefined') {
            return;
        }

        this.isHeaderCompact = window.scrollY > 100;
    }

    private scrollContentTitleIntoView(): void {
        if (typeof window === 'undefined' || !this.policyContent) {
            return;
        }

        const headerOffset = this.isHeaderCompact ? 76 : 156;
        const contentTop = this.policyContent.nativeElement.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({
            top: Math.max(contentTop - headerOffset, 0),
            left: 0,
            behavior: 'auto'
        });
    }
}
