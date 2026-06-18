import { Routes } from '@angular/router';
import { Contact } from './pages/contact/contact';
import { AboutUs } from './pages/about-us/about-us';
import { OrderDetail } from './pages/orders/order-detail/order-detail';
import { OrderReview } from './pages/orders/order-review/order-review';
import { Homepage } from './pages/homepage/homepage';
import { Design3d } from './pages/design3d/design3d';
export const routes: Routes = [
     {
    path: '',
    redirectTo: 'contact',
    pathMatch: 'full'
  },

  {
    path: 'contact',
    component: Contact
  },

  {
    path: 'about-us',
    component: AboutUs
  },

  {
    path: 'order-detail',
    component: OrderDetail
  },

  {
    path: 'order-review',
    component: OrderReview
  },
  {
    path: 'homepage',
    component: Homepage
  },
  {
    path: 'design3d',
    component: Design3d
  },
];
