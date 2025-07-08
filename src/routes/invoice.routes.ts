import { Router } from 'express';
import { InvoiceController } from '../controllers/invoice.controller';

const invoiceRouter = Router();

invoiceRouter.post('/create-invoice', InvoiceController.createInvoice);
invoiceRouter.get('/', InvoiceController.getInvoices);
// invoiceRouter.get('/', InvoiceController.getInvoicesDetailed);
invoiceRouter.get('/:id/pdf', InvoiceController.getInvoicePDF);
invoiceRouter.get('/send', InvoiceController.sendInvoice);
invoiceRouter.get('/:id', InvoiceController.getInvoiceById);
invoiceRouter.put('/:id', InvoiceController.updateInvoice); // Add this line for edit functionality


export default invoiceRouter;
