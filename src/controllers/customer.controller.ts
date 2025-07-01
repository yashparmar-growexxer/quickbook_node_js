import { Request, Response } from 'express';
import { QuickBooksService } from '../services/quickbooks.service';

export class CustomerController {
  static async createCustomer(req: Request, res: Response): Promise <void> {
    try {
      if (!req.body.displayName || !req.body.email) {
         res.status(400).json({ error: 'displayName and email are required' });
      }

      const customerData = {
        DisplayName: req.body.displayName,
        GivenName: req.body.firstName || '',
        FamilyName: req.body.lastName || '',
        PrimaryEmailAddr: { Address: req.body.email },
        PrimaryPhone: { FreeFormNumber: req.body.phone || '' },
        BillAddr: {
          Line1: req.body.addressLine1 || '',
          City: req.body.city || '',
          Country: req.body.country || '',
          PostalCode: req.body.postalCode || ''
        },
        Notes: req.body.notes || '',
        CompanyName: req.body.companyName || ''
      };

      const result = await QuickBooksService.apiRequest(
        'POST',
        `/v3/company/${process.env.QB_REALM_ID}/customer?minorversion=65`,
        customerData
      );

      res.status(201).json({
        id: result.Customer.Id,
        name: result.Customer.DisplayName,
        email: result.Customer.PrimaryEmailAddr?.Address,
        qboId: result.Customer.Id
      });
    } catch (error) {
      if (error instanceof Error) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Unknown error occurred' });
      }
    }
  }

  static async getAllCustomers(req: Request, res: Response) {
    try {
      const query = 'SELECT * FROM Customer MAXRESULTS 1000';
      const result = await QuickBooksService.apiRequest(
        'GET',
        `/v3/company/${process.env.QB_REALM_ID}/query?query=${encodeURIComponent(query)}`
      );
      res.json(result.QueryResponse.Customer || []);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  }

 static async getMinimalCustomers(req: Request, res: Response) {
    try {
      // Corrected query with valid fields
      const query = `SELECT Id, DisplayName, PrimaryEmailAddr, PrimaryPhone 
        FROM Customer 
        WHERE Id >= '20' AND Id <= '30'
        MAXRESULTS 1000`;
      
      const url = `/v3/company/${process.env.QB_REALM_ID}/query?query=${encodeURIComponent(query)}`;
      
      const result = await QuickBooksService.apiRequest('GET', url);

      if (!result.QueryResponse) {
        throw new Error('Unexpected response format from QuickBooks');
      }

      const customers = result.QueryResponse.Customer?.map((customer: any) => ({
        id: customer.Id,
        displayName: customer.DisplayName,
        email: customer.PrimaryEmailAddr?.Address,
        phone: customer.PrimaryPhone?.FreeFormNumber
        // Removed country since BillAddr is not available
      })) || [];

      res.json(customers);
    } catch (error) {
      console.error('Error in getMinimalCustomers:', error);
      res.status(500).json({ 
        error: (error as Error).message,
        details: (error as any).response?.data
      });
    }
  }
  static async getCustomerById(req: Request, res: Response) {
    try {
      const result = await QuickBooksService.apiRequest(
        'GET',
        `/v3/company/${process.env.QB_REALM_ID}/customer/${req.params.id}`
      );
      res.json(result.Customer);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  }

  static async updateCustomer(req: Request, res: Response) {
    try {
      const currentCustomer = await QuickBooksService.apiRequest(
        'GET',
        `/v3/company/${process.env.QB_REALM_ID}/customer/${req.params.id}`
      );

      const updateData = {
        ...req.body,
        Id: req.params.id,
        SyncToken: currentCustomer.Customer.SyncToken,
        sparse: true
      };

      const result = await QuickBooksService.apiRequest(
        'POST',
        `/v3/company/${process.env.QB_REALM_ID}/customer`,
        updateData
      );

      res.json(result.Customer);
    } catch (error) {
      res.status(500).json({ 
        error: (error as any).response?.data || (error as Error).message 
      });
    }
  }
}