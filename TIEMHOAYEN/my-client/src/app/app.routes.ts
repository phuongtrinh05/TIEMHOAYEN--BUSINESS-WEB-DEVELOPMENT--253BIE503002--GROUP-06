import { Routes } from '@angular/router';

import { ChatbotWidget } from './components/chatbot-widget/chatbot-widget';

// =========================
// MAIN PAGES
// =========================
import { Homepage } from './pages/homepage/homepage';
import { Contact } from './pages/contact/contact';
import { AboutUs } from './pages/about-us/about-us';
import { AccountComponent } from './pages/account/account';
import { BlogComponent } from './pages/blog/blog';
import { BlogDetailComponent } from './pages/blog-detail/blog-detail';
import { CategoryComponent } from './pages/category/category';
import { Design3d } from './pages/design3d/design3d';

// =========================
// AUTH
// =========================
import { LoginComponent } from './pages/login/login';
import { RegisterComponent } from './pages/register/register';
import { ForgotPasswordComponent } from './pages/forgot-password/forgot-password';

// =========================
// ORDER
// =========================
import { CartComponent } from './pages/orders/cart/cart';
import { CheckoutComponent } from './pages/orders/checkout/checkout';
import { OrderList } from './pages/orders/order-list/order-list';

// =========================
// ORDERS
// =========================
import { OrderDetail } from './pages/orders/order-detail/order-detail';
import { OrderReview } from './pages/orders/order-review/order-review';
import { OrderHauntComponent } from './pages/orders/order-haunt/order-haunt';
import { OrderRegistrantComponent } from './pages/orders/order-registrant/order-registrant';

// =========================
// PRODUCT
// =========================
import { ProductDetailComponent } from './pages/product-detail/product-detail';

// =========================
// POLICY
// =========================
// PolicyLayoutComponent đã import tất cả component chính sách con,
// nên app.routes.ts chỉ cần import component này.
import { PolicyLayoutComponent } from './pages/policy/policy-layout';

export const routes: Routes = [
  // =========================
  // DEFAULT
  // =========================
  {
    path: '',
    redirectTo: 'homepage',
    pathMatch: 'full',
  },

  // =========================
  // MAIN PAGES
  // =========================
  {
    path: 'homepage',
    component: Homepage,
    title: 'Trang chủ - Tiệm Hoa Yên',
  },
  {
    path: 'contact',
    component: Contact,
    title: 'Liên hệ - Tiệm Hoa Yên',
  },
  {
    path: 'about-us',
    component: AboutUs,
    title: 'Về chúng tôi - Tiệm Hoa Yên',
  },
  {
    path: 'account',
    component: AccountComponent,
    title: 'Tài khoản - Tiệm Hoa Yên',
  },
  {
    path: 'blog',
    component: BlogComponent,
    title: 'Blog - Tiệm Hoa Yên',
  },
  {
    path: 'blog-detail/:id',
    component: BlogDetailComponent,
    title: 'Chi tiết bài viết - Tiệm Hoa Yên',
  },
  {
    path: 'category',
    component: CategoryComponent,
    title: 'Sản phẩm - Tiệm Hoa Yên',
  },
  {
    path: 'design3d',
    component: Design3d,
    title: 'Thiết kế 3D - Tiệm Hoa Yên',
  },
  {
    path: 'design-3d',
    redirectTo: 'design3d',
    pathMatch: 'full',
  },
  {
    path: 'chatbot-widget',
    component: ChatbotWidget,
    title: 'Chatbot - Tiệm Hoa Yên',
  },

  // =========================
  // AUTH
  // =========================
  {
    path: 'login',
    component: LoginComponent,
    title: 'Đăng nhập - Tiệm Hoa Yên',
  },
  {
    path: 'register',
    component: RegisterComponent,
    title: 'Đăng ký - Tiệm Hoa Yên',
  },
  {
    path: 'forgot-password',
    component: ForgotPasswordComponent,
    title: 'Quên mật khẩu - Tiệm Hoa Yên',
  },

  // =========================
  // CART & CHECKOUT
  // =========================
  {
    path: 'cart',
    component: CartComponent,
    title: 'Giỏ hàng - Tiệm Hoa Yên',
  },
  {
    path: 'checkout',
    component: CheckoutComponent,
    title: 'Thanh toán - Tiệm Hoa Yên',
  },
  {
    path: 'order-list',
    component: OrderList,
    title: 'Danh sách đơn hàng - Tiệm Hoa Yên',
  },

  // =========================
  // ORDER DETAIL & REVIEW
  // =========================
  {
    path: 'order-detail/:id',
    component: OrderDetail,
    title: 'Chi tiết đơn hàng - Tiệm Hoa Yên',
  },
  {
    path: 'order-detail',
    component: OrderDetail,
    title: 'Tra cứu đơn hàng - Tiệm Hoa Yên',
  },
  {
    path: 'order-review',
    component: OrderReview,
    title: 'Đánh giá đơn hàng - Tiệm Hoa Yên',
  },

  // =========================
  // ORDER FORM
  // =========================
  {
    path: 'order-haunt',
    component: OrderHauntComponent,
    title: 'Đặt hàng khách vãng lai - Tiệm Hoa Yên',
  },
  {
    path: 'order-registrant',
    component: OrderRegistrantComponent,
    title: 'Đặt hàng - Tiệm Hoa Yên',
  },

  // =========================
  // CHECKOUT RESULT
  // =========================
  {
    path: 'checkout-fail',
    redirectTo: 'checkout',
    pathMatch: 'full',
  },
  {
    path: 'checkoutfail',
    redirectTo: 'checkout',
    pathMatch: 'full',
  },
  {
    path: 'checkout-successfull',
    redirectTo: 'checkout',
    pathMatch: 'full',
  },
  {
    path: 'checkoutsuccessfull',
    redirectTo: 'checkout',
    pathMatch: 'full',
  },
  {
    path: 'checkout-successful',
    redirectTo: 'checkout',
    pathMatch: 'full',
  },
  {
    path: 'checkoutsuccessful',
    redirectTo: 'checkout',
    pathMatch: 'full',
  },

  // =========================
  // PRODUCT DETAIL
  // =========================
  {
    path: 'product-detail/:id',
    component: ProductDetailComponent,
    title: 'Chi tiết sản phẩm - Tiệm Hoa Yên',
  },
  {
    path: 'product/:id',
    redirectTo: 'product-detail/:id',
    pathMatch: 'full',
  },

  // =========================
  // CATEGORY FILTERS
  // =========================
  {
    path: 'chu-de/:id',
    component: CategoryComponent,
    title: 'Sản phẩm theo chủ đề - Tiệm Hoa Yên',
  },
  {
    path: 'doi-tuong/:id',
    component: CategoryComponent,
    title: 'Sản phẩm theo đối tượng - Tiệm Hoa Yên',
  },
  {
    path: 'kieu-dang/:id',
    component: CategoryComponent,
    title: 'Sản phẩm theo kiểu dáng - Tiệm Hoa Yên',
  },
  {
    path: 'hoa-tuoi/:id',
    component: CategoryComponent,
    title: 'Sản phẩm theo loại hoa - Tiệm Hoa Yên',
  },
  {
    path: 'mau-sac/:id',
    component: CategoryComponent,
    title: 'Sản phẩm theo màu sắc - Tiệm Hoa Yên',
  },
  {
    path: 'chat-lieu/:id',
    component: CategoryComponent,
    title: 'Sản phẩm theo chất liệu - Tiệm Hoa Yên',
  },
  {
    path: 'bo-suu-tap/:id',
    component: CategoryComponent,
    title: 'Bộ sưu tập - Tiệm Hoa Yên',
  },

  // =========================
  // POLICY
  // =========================
  // Truy cập /policy sẽ mặc định mở chính sách đặt hàng.
  {
    path: 'policy',
    redirectTo: 'policy/order',
    pathMatch: 'full',
  },
  {
    path: 'policy/:slug',
    component: PolicyLayoutComponent,
    title: 'Điều khoản và chính sách - Tiệm Hoa Yên',
  },

  // =========================
  // POLICY ALIASES
  // =========================
  {
    path: 'order-policy',
    redirectTo: 'policy/order',
    pathMatch: 'full',
  },
  {
    path: 'payment-policy',
    redirectTo: 'policy/payment',
    pathMatch: 'full',
  },
  {
    path: 'delivery-policy',
    redirectTo: 'policy/delivery',
    pathMatch: 'full',
  },
  {
    path: 'membership-policy',
    redirectTo: 'policy/membership',
    pathMatch: 'full',
  },
  {
    path: 'return-policy',
    redirectTo: 'policy/return',
    pathMatch: 'full',
  },
  {
    path: 'privacy-policy',
    redirectTo: 'policy/privacy',
    pathMatch: 'full',
  },
  {
    path: 'customer-support-policy',
    redirectTo: 'policy/customer-support',
    pathMatch: 'full',
  },
  {
    path: 'registration-terms-conditions',
    redirectTo: 'policy/registration-terms',
    pathMatch: 'full',
  },

  // =========================
  // FALLBACK
  // =========================
  {
    path: '**',
    redirectTo: 'homepage',
  },
];
