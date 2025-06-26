import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller';

const paymentRouter = Router();

// Create a new payment
paymentRouter.post('/', PaymentController.createPayment);

// Get payments with optional filters
paymentRouter.get('/', PaymentController.getPayments);

// Get detailed payment information
paymentRouter.get('/:id', PaymentController.getPaymentDetails);

// Update a payment
paymentRouter.put('/:id', PaymentController.updatePayment);

// Delete a payment
paymentRouter.delete('/:id', PaymentController.deletePayment);

// Void a payment
paymentRouter.post('/:id/void', PaymentController.voidPayment);

// Get payment as PDF
paymentRouter.get('/:id/pdf', PaymentController.getPaymentPDF);

// Send payment receipt
paymentRouter.post('/:id/send', PaymentController.sendPaymentReceipt);

export default paymentRouter;