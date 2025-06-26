import { Router } from 'express';
import { InvoiceController } from '../controllers/invoice.controller';

const invoiceRouter = Router();

invoiceRouter.post('/create-invoice', InvoiceController.createInvoice);
// invoiceRouter.get('/', InvoiceController.getInvoices);
invoiceRouter.get('/', InvoiceController.getInvoicesDetailed);
invoiceRouter.get('/:id/pdf', InvoiceController.getInvoicePDF);

export default invoiceRouter;