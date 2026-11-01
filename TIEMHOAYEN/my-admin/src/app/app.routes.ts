import {LuckyWheelAdmin} from './pages/promotions/lucky-wheel/lucky-wheel';
import {ContentWorkspace} from './pages/content/content-workspace/content-workspace';
import { Routes } from '@angular/router';

import { Login } from './pages/login/login';
import { OrderRequests } from './pages/orders/order-requests/order-requests';

import { Dashboard } from './pages/dashboard/dashboard';
import { Analytics } from './pages/dashboard/analytics/analytics';
import { ReportList } from './pages/dashboard/reports/report-list';
import { ReportDetail } from './pages/dashboard/reports/report-detail';

import { CustomerComponent } from './pages/customers/customer-overview/customer-overview';
import { CustomerDetailComponent } from './pages/customers/customer-detail/customer-detail';

import { MaterialListComponent } from './pages/materials/material-list/material-list';
import { ImportListComponent } from './pages/materials/import-list/import-list';
import { ExportListComponent } from './pages/materials/export-list/export-list';
import { SupplierListComponent } from './pages/materials/supplier-list/supplier-list';
import { PurchaseOrderListComponent } from './pages/materials/purchase-order-list/purchase-order-list';
import { BomListComponent } from './pages/materials/bom-list/bom-list';
import { StockOverviewComponent } from './pages/materials/stock-overview/stock-overview';

import { TransactionListComponent } from './pages/transactions/transaction-list';

import { CampaignListComponent } from './pages/promotions/campaign-list/campaign-list';
import { VoucherListComponent } from './pages/promotions/voucher-list/voucher-list';

import { ProductDetail } from './pages/products/product-detail/product-detail';
import { ProductList } from './pages/products/product-list/product-list';
import { CategoryList } from './pages/products/category-list/category-list';

import { OrderList } from './pages/orders/order-list/order-list';
import { CreateOrder } from './pages/orders/create-order/create-order';
import { OrderDetail } from './pages/orders/order-detail/order-detail';

import { CustomerChatComponent } from './pages/customer-service/customer-chat/customer-chat';
import { SupportInbox } from './pages/customer-service/support-inbox/support-inbox';
import { ChatbotManagementComponent } from './pages/customer-service/chatbot-management/chatbot-management';

import { ArticleList } from './pages/content/article-list/article-list';
import { CreateArticle } from './pages/content/create-article/create-article';
import { ArticleDetail } from './pages/content/article-detail/article-detail';

import { EmployeeService } from './pages/employee-service/employee-service';

import { RolePermission } from './pages/role-permission/role-permission';
import { AdminAccount } from './pages/admin-account/admin-account';
import { AuditLogsComponent } from './pages/audit-logs/audit-logs';
import { adminPermissionGuard } from './services/admin-permission.guard';

export const routes: Routes = [
    { path: 'audit-logs', component: AuditLogsComponent, canActivate: [adminPermissionGuard], data: { module: 'system' } },
    {path:'promotions/lucky-wheel',component:LuckyWheelAdmin,canActivate:[adminPermissionGuard],data:{module:'promotions'}},
    { path: 'customer-service/legacy-chat', component: CustomerChatComponent, canActivate: [adminPermissionGuard], data: { module: 'customerService' } },
    { path: 'orders/requests', component: OrderRequests, canActivate: [adminPermissionGuard], data: { module: 'orders' } },
    {
        path: '',
        redirectTo: 'login',
        pathMatch: 'full'
    },

    {
    path: 'login',
    component: Login
    },

    {
        path: 'dashboard',
        component: Dashboard,
        canActivate: [adminPermissionGuard],
        data: { module: 'dashboard' }
    },
    // Tổng quan ▸ Bảng phân tích / Danh sách báo cáo
    { path: 'dashboard/analytics', component: Analytics, canActivate: [adminPermissionGuard], data: { module: 'dashboard' } },
    { path: 'dashboard/reports', component: ReportList, canActivate: [adminPermissionGuard], data: { module: 'dashboard' } },
    { path: 'dashboard/reports/:key', component: ReportDetail, canActivate: [adminPermissionGuard], data: { module: 'dashboard' } },

    {
        path: 'orders',
        redirectTo: 'orders/order-list',
        pathMatch: 'full'
    },
    {
        path: 'orders/order-list',
        component: OrderList,
        canActivate: [adminPermissionGuard],
        data: { module: 'orders' }
    },
    {
        path: 'orders/create-order',
        component: CreateOrder,
        canActivate: [adminPermissionGuard],
        data: { module: 'orders' }
    },
    {
        path: 'orders/order-detail/:id',
        component: OrderDetail,
        canActivate: [adminPermissionGuard],
        data: { module: 'orders' }
    },
    {
        path: 'orders/order-detail',
        component: OrderDetail,
        canActivate: [adminPermissionGuard],
        data: { module: 'orders' }
    },
    {
        path: 'orders/:id',
        component: OrderDetail,
        canActivate: [adminPermissionGuard],
        data: { module: 'orders' }
    },

    {
        path: 'transactions',
        component: TransactionListComponent,
        canActivate: [adminPermissionGuard],
        data: { module: 'payments' }
    },

    {
        path: 'products',
        redirectTo: 'products/product-list',
        pathMatch: 'full'
    },
    {
        path: 'products/product-list',
        component: ProductList,
        canActivate: [adminPermissionGuard],
        data: { module: 'products' }
    },
    {
        path: 'products/product-detail',
        component: ProductDetail,
        canActivate: [adminPermissionGuard],
        data: { module: 'products' }
    },
    {
        path: 'products/category-list',
        component: CategoryList,
        canActivate: [adminPermissionGuard],
        data: { module: 'products' }
    },

    {
        path: 'materials',
        component: MaterialListComponent,
        canActivate: [adminPermissionGuard],
        data: { module: 'materials' }
    },
    {
        path: 'materials/imports',
        component: ImportListComponent,
        canActivate: [adminPermissionGuard],
        data: { module: 'materials' }
    },
    {
        path: 'materials/exports',
        component: ExportListComponent,
        canActivate: [adminPermissionGuard],
        data: { module: 'materials' }
    },
    {
        path: 'materials/suppliers',
        component: SupplierListComponent,
        canActivate: [adminPermissionGuard],
        data: { module: 'materials' }
    },
    {
        path: 'materials/purchase-orders',
        component: PurchaseOrderListComponent,
        canActivate: [adminPermissionGuard],
        data: { module: 'materials' }
    },
    {
        path: 'materials/boms',
        component: BomListComponent,
        canActivate: [adminPermissionGuard],
        data: { module: 'materials' }
    },
    {
        path: 'materials/stock',
        component: StockOverviewComponent,
        canActivate: [adminPermissionGuard],
        data: { module: 'materials' }
    },

    {
        path: 'customers',
        component: CustomerComponent,
        canActivate: [adminPermissionGuard],
        data: { module: 'customers' }
    },
    {
        path: 'customers/detail',
        component: CustomerDetailComponent,
        canActivate: [adminPermissionGuard],
        data: { module: 'customers' }
    },
    {
        path: 'customers/:id',
        component: CustomerDetailComponent,
        canActivate: [adminPermissionGuard],
        data: { module: 'customers' }
    },

    {
        path: 'promotions',
        component: CampaignListComponent,
        canActivate: [adminPermissionGuard],
        data: { module: 'promotions' }
    },
    {
        path: 'promotions/vouchers',
        component: VoucherListComponent,
        canActivate: [adminPermissionGuard],
        data: { module: 'promotions' }
    },

    {
        path: 'customer-service',
        redirectTo: 'customer-service/customer-chat',
        pathMatch: 'full'
    },
    {
        path: 'customer-service/customer-chat',
        component: SupportInbox,
        canActivate: [adminPermissionGuard],
        data: { module: 'customerService' }
    },
    {
        path: 'customer-service/legacy-chat',
        component: CustomerChatComponent,
        canActivate: [adminPermissionGuard],
        data: { module: 'customerService' }
    },
    {
        path: 'customer-service/chatbot-management',
        component: ChatbotManagementComponent,
        canActivate: [adminPermissionGuard],
        data: { module: 'customerService' }
    },

    {
        path: 'employee-service',
        component: EmployeeService,
        canActivate: [adminPermissionGuard],
        data: { module: 'customerService' }
    },

    {
        path: 'content',
        redirectTo: 'content/article-list',
        pathMatch: 'full'
    },
    {
        path: 'content/article-list',
        component: ContentWorkspace,
        canDeactivate: [(component:ContentWorkspace)=>component.canLeave()],
        canActivate: [adminPermissionGuard],
        data: { module: 'content' }
    },
    {
        path: 'content/website-information',
        component: ArticleList,
        canActivate: [adminPermissionGuard],
        data: { module: 'content' }
    },
    {
        path: 'content/create-article',
        component: ContentWorkspace,
        canDeactivate: [(component:ContentWorkspace)=>component.canLeave()],
        canActivate: [adminPermissionGuard],
        data: { module: 'content' }
    },
    {
        path: 'content/article-detail/:id',
        component: ContentWorkspace,
        canDeactivate: [(component:ContentWorkspace)=>component.canLeave()],
        canActivate: [adminPermissionGuard],
        data: { module: 'content' }
    },

    {
        path: 'admin-account',
        component: AdminAccount,
        canActivate: [adminPermissionGuard],
        data: { module: 'permissions' }
    },
    {
        path: 'role-permission',
        component: RolePermission,
        canActivate: [adminPermissionGuard],
        data: { module: 'permissions' }
    },

    {
        path: 'design-library',
        redirectTo: 'dashboard',
        pathMatch: 'full'
    },

    {
        path: '**',
        redirectTo: 'dashboard'
    }
];
