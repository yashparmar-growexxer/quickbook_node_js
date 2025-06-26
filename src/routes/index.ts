import { Router } from 'express';
import customerRoutes from './customer.routes';
import invoiceRoutes from './invoice.routes';

const router = Router();

router.use('/customers', customerRoutes);
router.use('/invoices',invoiceRoutes)



export default router;