import sql from 'mssql';

// Cấu hình Database
const sqlConfig: sql.config = {
    user: 'tiemhoayen-sql-2603',
    password: 'Password_123#',
    server: 'tiemhoayenadmin.database.windows.net',
    port: 1433,
    database: 'TIEM_HOA_YEN',
    options: {
        encrypt: true,
        trustServerCertificate: true
    }
};

let pool: sql.ConnectionPool | null = null;

// Hàm kết nối (singleton pool)
export const connectDB = async (): Promise<sql.ConnectionPool> => {
    if (pool) return pool;
    try {
        pool = await sql.connect(sqlConfig);
        console.log('Đã kết nối thành công tới SQL Server!');
        return pool;
    } catch (err) {
        console.error('Lỗi kết nối SQL Server: ', err);
        process.exit(1);
    }
};

export { sql };
