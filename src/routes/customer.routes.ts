import { Router } from 'express';
import { CustomerController } from '../controllers/customer.controller';

const customerRouter = Router();

// Create a new customer
customerRouter.post('/create-customer', CustomerController.createCustomer);

// Get all customers
customerRouter.get('/', CustomerController.getAllCustomers);

// Get minimal customer data
customerRouter.get('/minimal', CustomerController.getMinimalCustomers);

// Get single customer by ID
customerRouter.get('/:id', CustomerController.getCustomerById);

// Update customer
customerRouter.put('/:id', CustomerController.updateCustomer);

export default customerRouter;