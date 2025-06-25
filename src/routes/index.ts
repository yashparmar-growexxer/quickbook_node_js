import { Router } from 'express';
import customerRoutes from './customer.routes';

const router = Router();

router.use('/customers', customerRoutes);



export default router;