# Local authentication/OTP snapshot

This branch preserves local work for review. Do not merge or deploy yet.
Compared against main 8d3d31c using the original ZIP baseline: 23 files require manual integration with newer Sales, inventory, and content modules.

Local checks previously passed: server TypeScript, both frontend builds. Latest label change is template text only. These checks do not validate integration against current main.

No production environment files, local database or OTP logs are included.

Conflicting files:
- TIEMHOAYEN/my-server/.gitignore
- TIEMHOAYEN/my-server/mongo.ts
- TIEMHOAYEN/my-server/package-lock.json
- TIEMHOAYEN/my-server/package.json
- TIEMHOAYEN/my-server/server.ts
- TIEMHOAYEN/my-admin/src/app/app.routes.ts
- TIEMHOAYEN/my-admin/src/app/services/admin-auth.interceptor.ts
- TIEMHOAYEN/my-client/src/app/app.config.ts
- TIEMHOAYEN/my-client/src/app/components/chatbot-widget/chatbot-widget.ts
- TIEMHOAYEN/my-server/controllers/admin.ts
- TIEMHOAYEN/my-server/controllers/blog.ts
- TIEMHOAYEN/my-server/controllers/chat.ts
- TIEMHOAYEN/my-server/controllers/contact.ts
- TIEMHOAYEN/my-server/controllers/customer.ts
- TIEMHOAYEN/my-server/controllers/employee.ts
- TIEMHOAYEN/my-server/controllers/faq.ts
- TIEMHOAYEN/my-server/controllers/notification.ts
- TIEMHOAYEN/my-server/controllers/order.ts
- TIEMHOAYEN/my-server/controllers/review.ts
- TIEMHOAYEN/my-server/controllers/rolePermission.ts
- TIEMHOAYEN/my-server/middleware/rolePermission.ts
- TIEMHOAYEN/my-server/routes/order.ts
- TIEMHOAYEN/my-server/services/admin-order.service.ts
