import { Routes } from '@angular/router';

import { Login } from './pages/login/login';

import { Dashboard } from './pages/dashboard/dashboard';

import { CustomerComponent } from './pages/customers/customer-overview/customer-overview';
import { CustomerDetailComponent } from './pages/customers/customer-detail/customer-detail';

import { MaterialListComponent } from './pages/materials/material-list/material-list';
import { ImportListComponent } from './pages/materials/import-list/import-list';
import { ExportListComponent } from './pages/materials/export-list/export-list';
import { SupplierListComponent } from './pages/materials/supplier-list/supplier-list';

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
import { ChatbotManagementComponent } from './pages/customer-service/chatbot-management/chatbot-management';

import { ArticleList } from './pages/content/article-list/article-list';
import { CreateArticle } from './pages/content/create-article/create-article';
import { ArticleDetail } from './pages/content/article-detail/article-detail';

import { EmployeeService } from './pages/employee-service/employee-service';

import { RolePermission } from './pages/role-permission/role-permission';
import { AdminAccount } from './pages/admin-account/admin-account';
import { adminPermissionGuard } from './services/admin-permission.guard';

export const routes: Routes = [
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
        component: ArticleList,
        canActivate: [adminPermissionGuard],
        data: { module: 'content' }
    },
    {
        path: 'content/create-article',
        component: CreateArticle,
        canActivate: [adminPermissionGuard],
        data: { module: 'content' }
    },
    {
        path: 'content/article-detail/:id',
        component: ArticleDetail,
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
