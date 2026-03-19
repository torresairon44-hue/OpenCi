/**
 * OPENCI API SERVICE (Option C)
 * Integration with OpenCI platform APIs
 * Supports real-time data retrieval and updates
 */

import axios, { AxiosInstance } from 'axios';
import dotenv from 'dotenv';

dotenv.config();

interface APIConfig {
  baseURL: string;
  apiKey: string;
  timeout: number;
}

interface OpenCIConversation {
  id: string;
  title: string;
  status: string;
  client_name?: string;
  bank?: string;
  module?: string;
  created_at: Date;
  updated_at: Date;
}

interface OpenCIActivity {
  id: string;
  agent_id: string;
  activity_type: 'DRIVING' | 'SKIP_TRACE' | 'TOUCH_POINT' | 'DISPOSITION';
  location?: { lat: number; lng: number };
  timestamp: Date;
  status: string;
  details?: any;
}

interface OpenCIDemandLetter {
  id: string;
  client_id: string;
  status: 'GENERATED' | 'PRINTED' | 'RELEASED_TO_OIC' | 'RELEASED_TO_FM' | 'VISITED' | 'DONE' | 'RETURNED' | 'PULLED_OUT';
  bank: string;
  created_at: Date;
  visited_at?: Date;
}

interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
}

class OpenCIAPI {
  private client: AxiosInstance;
  private config: APIConfig;
  private isAuthenticated = false;

  constructor() {
    this.config = {
      baseURL: process.env.OPENCI_API_URL || 'https://api.openci.spmadrid.com',
      apiKey: process.env.OPENCI_API_KEY || '',
      timeout: 10000
    };

    this.client = axios.create({
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey
      }
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      response => response,
      error => {
        console.error('OpenCI API Error:', error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Authenticate with OpenCI API
   */
  async authenticate(): Promise<boolean> {
    try {
      if (!this.config.apiKey) {
        console.warn('⚠ OpenCI API Key not configured - using template mode');
        this.isAuthenticated = false;
        return false;
      }

      const response = await this.client.post('/auth/verify', {});
      this.isAuthenticated = response.status === 200;
      console.log('✓ OpenCI API authenticated');
      return true;
    } catch (error: any) {
      console.warn('⚠ Could not authenticate with OpenCI API:', error.message?.substring(0, 50));
      this.isAuthenticated = false;
      return false;
    }
  }

  /**
   * Get real-time status: modules, users, active agents
   */
  async getSystemStatus(): Promise<APIResponse<any>> {
    try {
      if (!this.isAuthenticated) {
        return {
          success: false,
          error: 'Not authenticated - returning template data',
          timestamp: new Date()
        };
      }

      const response = await this.client.get('/system/status');
      return {
        success: true,
        data: response.data,
        timestamp: new Date()
      };
    } catch (error: any) {
      console.error('Error fetching system status:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Get field agent activities
   */
  async getAgentActivities(agentId: string, limit = 20): Promise<APIResponse<OpenCIActivity[]>> {
    try {
      if (!this.isAuthenticated) {
        return {
          success: false,
          error: 'Not authenticated',
          timestamp: new Date()
        };
      }

      const response = await this.client.get(`/agents/${agentId}/activities`, {
        params: { limit }
      });

      return {
        success: true,
        data: response.data,
        timestamp: new Date()
      };
    } catch (error: any) {
      console.error('Error fetching agent activities:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Get demand letter status
   */
  async getDemandLetterStatus(dlId: string): Promise<APIResponse<OpenCIDemandLetter>> {
    try {
      if (!this.isAuthenticated) {
        return {
          success: false,
          error: 'Not authenticated',
          timestamp: new Date()
        };
      }

      const response = await this.client.get(`/demand-letters/${dlId}`);
      return {
        success: true,
        data: response.data,
        timestamp: new Date()
      };
    } catch (error: any) {
      console.error('Error fetching DL status:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Search clients
   */
  async searchClients(query: string, bank?: string): Promise<APIResponse<any[]>> {
    try {
      if (!this.isAuthenticated) {
        return {
          success: false,
          error: 'Not authenticated',
          timestamp: new Date()
        };
      }

      const response = await this.client.get('/clients/search', {
        params: { q: query, bank }
      });

      return {
        success: true,
        data: response.data,
        timestamp: new Date()
      };
    } catch (error: any) {
      console.error('Error searching clients:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Get live map data for field agents
   */
  async getLiveMapData(filters?: { bank?: string; status?: string }): Promise<APIResponse<any>> {
    try {
      if (!this.isAuthenticated) {
        return {
          success: false,
          error: 'Not authenticated',
          timestamp: new Date()
        };
      }

      const response = await this.client.get('/map/live', {
        params: filters
      });

      return {
        success: true,
        data: response.data,
        timestamp: new Date()
      };
    } catch (error: any) {
      console.error('Error fetching live map:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Create new demand letter
   */
  async createDemandLetter(clientId: string, bankCode: string, letterConfig: any): Promise<APIResponse<OpenCIDemandLetter>> {
    try {
      if (!this.isAuthenticated) {
        return {
          success: false,
          error: 'Not authenticated',
          timestamp: new Date()
        };
      }

      const response = await this.client.post('/demand-letters', {
        client_id: clientId,
        bank_code: bankCode,
        ...letterConfig
      });

      return {
        success: true,
        data: response.data,
        timestamp: new Date()
      };
    } catch (error: any) {
      console.error('Error creating demand letter:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Update demand letter status
   */
  async updateDemandLetterStatus(dlId: string, status: string): Promise<APIResponse<OpenCIDemandLetter>> {
    try {
      if (!this.isAuthenticated) {
        return {
          success: false,
          error: 'Not authenticated',
          timestamp: new Date()
        };
      }

      const response = await this.client.patch(`/demand-letters/${dlId}`, {
        status
      });

      return {
        success: true,
        data: response.data,
        timestamp: new Date()
      };
    } catch (error: any) {
      console.error('Error updating DL status:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Log activity for skip & collect
   */
  async logActivity(agentId: string, activity: Omit<OpenCIActivity, 'id'>): Promise<APIResponse<OpenCIActivity>> {
    try {
      if (!this.isAuthenticated) {
        return {
          success: false,
          error: 'Not authenticated',
          timestamp: new Date()
        };
      }

      const response = await this.client.post(`/agents/${agentId}/activities`, activity);
      return {
        success: true,
        data: response.data,
        timestamp: new Date()
      };
    } catch (error: any) {
      console.error('Error logging activity:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Get workforce schedule
   */
  async getAgentSchedule(agentId: string, dateRange?: { startDate: Date; endDate: Date }): Promise<APIResponse<any>> {
    try {
      if (!this.isAuthenticated) {
        return {
          success: false,
          error: 'Not authenticated',
          timestamp: new Date()
        };
      }

      const params: any = {};
      if (dateRange) {
        params.start_date = dateRange.startDate.toISOString();
        params.end_date = dateRange.endDate.toISOString();
      }

      const response = await this.client.get(`/agents/${agentId}/schedule`, { params });
      return {
        success: true,
        data: response.data,
        timestamp: new Date()
      };
    } catch (error: any) {
      console.error('Error fetching schedule:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Get available forms for a module
   */
  async getAvailableForms(moduleCode: string): Promise<APIResponse<any[]>> {
    try {
      if (!this.isAuthenticated) {
        return {
          success: false,
          error: 'Not authenticated',
          timestamp: new Date()
        };
      }

      const response = await this.client.get('/forms', {
        params: { module: moduleCode }
      });

      return {
        success: true,
        data: response.data,
        timestamp: new Date()
      };
    } catch (error: any) {
      console.error('Error fetching forms:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Submit form data
   */
  async submitForm(formId: string, formData: any): Promise<APIResponse<any>> {
    try {
      if (!this.isAuthenticated) {
        return {
          success: false,
          error: 'Not authenticated',
          timestamp: new Date()
        };
      }

      const response = await this.client.post(`/forms/${formId}/submit`, formData);
      return {
        success: true,
        data: response.data,
        timestamp: new Date()
      };
    } catch (error: any) {
      console.error('Error submitting form:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Get API connection status
   */
  isConnected(): boolean {
    return this.isAuthenticated;
  }

  /**
   * Get configuration (for debugging)
   */
  getConfig(): Partial<APIConfig> {
    return {
      baseURL: this.config.baseURL,
      timeout: this.config.timeout
      // Don't expose API key
    };
  }
}

export { OpenCIAPI, OpenCIActivity, OpenCIDemandLetter, OpenCIConversation, APIResponse };
