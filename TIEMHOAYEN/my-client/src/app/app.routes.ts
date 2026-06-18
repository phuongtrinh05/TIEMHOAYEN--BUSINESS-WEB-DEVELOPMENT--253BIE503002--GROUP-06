import { Routes } from '@angular/router';

import { Homepage } from './pages/homepage/homepage';
import { Contact } from './pages/contact/contact';
import { AboutUs } from './pages/about-us/about-us';
import { AccountComponent } from './pages/account/account';
import { BlogComponent } from './pages/blog/blog';
import { CategoryComponent } from './pages/category/category';
import { Design3d } from './pages/design3d/design3d';
import { LoginComponent } from './pages/login/login';
import { RegisterComponent } from './pages/register/register';
import { ForgotPasswordComponent } from './pages/forgot-password/forgot-password';

import { CartComponent } from './pages/order/cart/cart';
import { CheckoutComponent } from './pages/order/checkout/checkout';
import { OrderList } from './pages/order/order-list/order-list';

import { OrderDetail } from './pages/orders/order-detail/order-detail';
import { OrderReview } from './pages/orders/order-review/order-review';

export const routes: Routes = [
  { path: '', redirectTo: 'homepage', pathMatch: 'full' },

  { path: 'homepage', component: Homepage },
  { path: 'contact', component: Contact },
  { path: 'about-us', component: AboutUs },
  { path: 'account', component: AccountComponent },
  { path: 'blog', component: BlogComponent },
  { path: 'category', component: CategoryComponent },
  { path: 'design3d', component: Design3d },

  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: 'forgot-password', component: ForgotPasswordComponent },

  { path: 'cart', component: CartComponent },
  { path: 'checkout', component: CheckoutComponent },
  { path: 'order-list', component: OrderList },

  { path: 'order-detail', component: OrderDetail },
  { path: 'order-review', component: OrderReview },

  { path: '**', redirectTo: 'homepage' }
];
