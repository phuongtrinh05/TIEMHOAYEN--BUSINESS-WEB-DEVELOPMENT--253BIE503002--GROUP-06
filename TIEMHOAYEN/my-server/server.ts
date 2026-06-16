import express, { Request, Response } from 'express';
import cors from 'cors';
import { connectDB } from './db';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Tạo một API mẫu cho trang chủ
app.get('/', (req: Request, res: Response) => {
    res.send('Server TypeScript đang hoạt động cực tốt!');
});

// Khởi động server sau khi kết nối DB thành công
const PORT = 3000;

(async () => {
    await connectDB();
    app.listen(PORT, () => {
        console.log(`Server đang chạy tại cổng http://localhost:${PORT}`);
    });
})();
