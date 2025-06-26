import axios from 'axios';
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

 static async apiRequest(
  method: string,
  endpoint: string,
  data?: any,
  responseType: 'json' | 'arraybuffer' = 'json'
) {
  const url = `${QB_BASE_URL}${endpoint}`;
  const accessToken = await this.refreshToken();

  try {
    const response = await axios({
      method,
      url,
      data,
      responseType, // Add this parameter
      timeout: 30000, // 30 seconds timeout added here
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': responseType === 'arraybuffer' ? 'application/pdf' : 'application/json',
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('QuickBooks API Error:', {
      url,
      status: error.response?.status,
      data: error.response?.data
    });
    throw error;
  }
}
}