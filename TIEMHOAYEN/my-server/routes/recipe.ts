import express from 'express';
import { getAllRecipes } from '../controllers/recipe.js';

const router = express.Router();
router.get('/', getAllRecipes);

export default router;
