import express, { Request, Response } from 'express';
import cors from 'cors';
import { connectDB } from './db.js';
import customerRoutes from './routes/customer.js'; // Import file route

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/customers', customerRoutes);

app.get('/', (req: Request, res: Response) => {
    res.send('Backend TIEM_HOA_YEN chạy theo cấu trúc Controllers/Routes thành công!');
});

const PORT = 3000;
(async () => {
    await connectDB();
    app.listen(PORT, () => {
        console.log(`Server: http://localhost:${PORT}`);
        console.log(`Danh sách khách hàng: http://localhost:${PORT}/api/customers`);
    });
})();