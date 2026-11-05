import express from 'express';
import { getAllEmployees, getEmployeeById } from '../controllers/employee.js';

// Quyền 'permissions' được kiểm tra ở server.ts cho toàn bộ /api/employees.
const router = express.Router();
router.get('/', getAllEmployees);
router.get('/:id', getEmployeeById);

export default router;
