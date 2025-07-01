import express, { Request, Response, Router } from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import cors from 'cors';
import routes from './routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT ;

app.use(cors());
app.use(express.json());
app.use('/api', routes);



// QuickBooks API Config
const QB_BASE_URL = process.env.QB_ENVIRONMENT === 'sandbox' 
  ? 'https://sandbox-quickbooks.api.intuit.com' 
  : 'https://quickbooks.api.intuit.com';

// ======================
//   Server Start
// ======================

app.listen(PORT, () => {
  console.log(`🚀 Customer Management API running on http://localhost:${PORT}`);
});