import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'orders/:id',
    renderMode: RenderMode.Server
  },
  {
    path: 'customers/:id',
    renderMode: RenderMode.Server
  },
  {
    path: 'content/article-detail/:id',
    renderMode: RenderMode.Server
  },
  {
    path: 'orders',
    renderMode: RenderMode.Server
  },
  {
    path: 'orders/order-list',
    renderMode: RenderMode.Server
  },
  {
    path: 'orders/create-order',
    renderMode: RenderMode.Server
  },
  {
    path: 'orders/order-detail/:id',
    renderMode: RenderMode.Server
  },  {
    path: '**',
    renderMode: RenderMode.Prerender
  }
];


