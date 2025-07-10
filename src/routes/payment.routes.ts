// In your routes file
import { PaymentController } from '../controllers/payment.controller';
import express from 'express';

const router = express.Router();

router.post('/', PaymentController.createPayment);
router.get('/', PaymentController.getPayments);
router.get('/:id', PaymentController.getPaymentById);
router.put('/:id', PaymentController.updatePayment);
router.delete('/:id', PaymentController.deletePayment);
router.post('/apply', PaymentController.applyPaymentToInvoice);

export default router;