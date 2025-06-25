import express, { Request, Response, Router } from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import cors from 'cors';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// QuickBooks API Config
const QB_BASE_URL = process.env.QB_ENVIRONMENT === 'sandbox' 
  ? 'https://sandbox-quickbooks.api.intuit.com' 
  : 'https://quickbooks.api.intuit.com';

// ======================
// OAuth 2.0 Token Management
// ======================

async function refreshToken(): Promise<string> {
  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', process.env.QB_REFRESH_TOKEN!);

    const response = await axios.post(
      'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      params.toString(),
      {
        auth: {
          username: process.env.QB_CLIENT_ID!,
          password: process.env.QB_CLIENT_SECRET!,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    process.env.QB_ACCESS_TOKEN = response.data.access_token;
    return response.data.access_token;
  } catch (error) {
    console.error('Token refresh failed:', error.response?.data || error.message);
    throw new Error('Authentication failed');
  }
}

// ======================
// QuickBooks API Wrappers
// ======================



async function qbApiRequest(method: string, endpoint: string, data?: any) {
  const url = `${QB_BASE_URL}${endpoint}`;
  const accessToken = await refreshToken();

  try {
    const response = await axios({
      method,
      url,
      data,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
    return response.data;
  } catch (error) {
    console.error('API Error:', error.response?.data || error.message);
    throw error;
  }
}

// ======================
// Customer Endpoints
// ======================

// Create Customer
app.post('/create-customer', async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate required fields
    if (!req.body.displayName || !req.body.email) {
      res.status(400).json({ error: 'displayName and email are required' });
      return;
    }

    const customerData = {
      DisplayName: req.body.displayName,
      GivenName: req.body.firstName || '',
      FamilyName: req.body.lastName || '',
      PrimaryEmailAddr: {
        Address: req.body.email
      },
      PrimaryPhone: {
        FreeFormNumber: req.body.phone || ''
      },
      BillAddr: {
        Line1: req.body.addressLine1 || '',
        City: req.body.city || '',
        Country: req.body.country || '',
        PostalCode: req.body.postalCode || ''
      },
      Notes: req.body.notes || '',
      CompanyName: req.body.companyName || ''
    };

    const result = await qbApiRequest(
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

  } catch (error: unknown) {
    // Type-safe error handling
    if (axios.isAxiosError(error)) {
      res.status(500).json({
        error: 'QuickBooks API Error',
        details: error.response?.data || error.message,
        code: error.code
      });
    } else if (error instanceof Error) {
      res.status(500).json({
        error: 'Server Error',
        message: error.message
      });
    } else {
      res.status(500).json({
        error: 'Unknown Error Occurred'
      });
    }
  }
});

// Get All Customers
app.get('/customers', async (req: Request, res: Response) => {
  try {
    const query = 'SELECT * FROM Customer MAXRESULTS 1000';
    const result = await qbApiRequest(
      'GET',
      `/v3/company/${process.env.QB_REALM_ID}/query?query=${encodeURIComponent(query)}`
    );
    res.json(result.QueryResponse.Customer || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/customers-minimal', async (req: Request, res: Response) => {
  try {
    // QuickBooks query to fetch only DisplayName and Id
    const query = `SELECT Id, DisplayName, PrimaryEmailAddr, PrimaryPhone
      FROM Customer
      WHERE Id >= '20' AND Id <= '30'
      MAXRESULTS 100`;
    
    const result = await qbApiRequest(
      'GET',
      `/v3/company/${process.env.QB_REALM_ID}/query?query=${encodeURIComponent(query)}`
    );

    // Format the response
    const customers = result.QueryResponse.Customer?.map((customer: {
      PrimaryEmailAddr: any;
      PrimaryPhone: any;
      BillAddr: any; Id: any; DisplayName: any; 
}) => ({
      id: customer.Id,
      displayName: customer.DisplayName,
      email: customer.PrimaryEmailAddr?.Address,
      phone: customer.PrimaryPhone?.FreeFormNumber,
      country: customer.BillAddr?.Country
    })) || [];

    res.json(customers);

  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      res.status(500).json({
        error: 'QuickBooks API Error',
        details: error.response?.data
      });
    } else {
      res.status(500).json({
        error: 'Server Error'
      });
    }
  }
});

// Get Customer by ID
app.get('/customers/:id', async (req: Request, res: Response) => {
  try {
    const result = await qbApiRequest(
      'GET',
      `/v3/company/${process.env.QB_REALM_ID}/customer/${req.params.id}`
    );
    res.json(result.Customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update Customer
app.put('/customers/:id', async (req: Request, res: Response) => {
  try {
    // First get current customer to obtain SyncToken
    const currentCustomer = await qbApiRequest(
      'GET',
      `/v3/company/${process.env.QB_REALM_ID}/customer/${req.params.id}`
    );

    const updateData = {
      ...req.body,
      Id: req.params.id,
      SyncToken: currentCustomer.Customer.SyncToken,
      sparse: true // Only update provided fields
    };

    const result = await qbApiRequest(
      'POST',
      `/v3/company/${process.env.QB_REALM_ID}/customer`,
      updateData
    );

    res.json(result.Customer);
  } catch (error) {
    res.status(500).json({   error: (error as any).response?.data || (error as Error).message  });
  }
});

// ======================
// Server Start
// ======================

app.listen(PORT, () => {
  console.log(`🚀 Customer Management API running on http://localhost:${PORT}`);
});