import axios, { AxiosRequestConfig } from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const QB_BASE_URL = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

export class QuickBooksService {
  static async refreshToken(): Promise<string> {
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

      return response.data.access_token;
    } catch (error) {
      throw new Error('Authentication failed');
    }
  }

  // In your QuickBooksService.apiRequest method:
static async apiRequest(
  method: string,
  endpoint: string,
  data?: any,
  responseType: 'json' | 'arraybuffer' = 'json',
  isUpdate: boolean = false
): Promise<any> {
  try {
    const url = `${QB_BASE_URL}${endpoint}`;
    const token = await this.refreshToken();

    const config: AxiosRequestConfig = {
      method,
      url,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      responseType,
      params: isUpdate ? { sparse: true } : {},
      data: data ? JSON.stringify(data) : undefined,
    };

    console.log('QuickBooks API Request:', {
      method,
      url,
      params: config.params,
      data: config.data,
    });

    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error('QuickBooks API Error:', {
      status: error.response?.status,
      data: error.response?.data,
      config: error.config,
    });
    throw error;
  }
}
}