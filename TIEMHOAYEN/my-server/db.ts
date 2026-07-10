import sql from 'mssql';

// Cấu hình Database
const sqlConfig: sql.config = {
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    server: process.env.SQL_SERVER ?? '',
    port: Number(process.env.SQL_PORT ?? 1433),
    database: process.env.SQL_DATABASE,
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
        throw err;
    }
};

export { sql };
