import { request } from 'node:https';
import { URL } from 'node:url';

const LINEAR_API_URL = 'https://api.linear.app/graphql';

export interface LinearViewer {
  name?: string | null;
  displayName?: string | null;
  organization?: {
    name?: string | null;
  } | null;
}

export interface LinearConnectionStatus {
  connected: boolean;
  workspaceName?: string;
  viewer?: LinearViewer;
  error?: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export class LinearService {
  private readonly SERVICE_NAME = 'emdash-linear';
  private readonly ACCOUNT_NAME = 'api-token';

  async saveToken(
    token: string
  ): Promise<{ success: boolean; workspaceName?: string; error?: string }> {
    try {
      const viewer = await this.fetchViewer(token);
      await this.storeToken(token);
      return {
        success: true,
        workspaceName: viewer?.organization?.name ?? viewer?.displayName ?? undefined,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to validate Linear token. Please try again.';
      return { success: false, error: message };
    }
  }

  async clearToken(): Promise<{ success: boolean; error?: string }> {
    try {
      const keytar = await import('keytar');
      await keytar.deletePassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
      return { success: true };
    } catch (error) {
      console.error('Failed to clear Linear token:', error);
      return {
        success: false,
        error: 'Unable to remove Linear token from keychain.',
      };
    }
  }

  async checkConnection(): Promise<LinearConnectionStatus> {
    try {
      const token = await this.getStoredToken();
      if (!token) {
        return { connected: false };
      }

      const viewer = await this.fetchViewer(token);
      return {
        connected: true,
        workspaceName: viewer?.organization?.name ?? viewer?.displayName ?? undefined,
        viewer,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to verify Linear connection.';
      return { connected: false, error: message };
    }
  }

  async initialFetch(limit = 5): Promise<any[]> {
    const token = await this.getStoredToken();
    if (!token) {
      throw new Error('Linear token not set. Connect Linear in settings first.');
    }

    const sanitizedLimit = Math.min(Math.max(limit, 1), 200);

    const query = `
      query ListIssues($limit: Int!) {
        issues(first: $limit, orderBy: updatedAt) {
          nodes {
            id
            identifier
            title
            url
            state { name type }
            team { name key }
            project { name }
            assignee { displayName name }
            updatedAt
          }
        }
      }
    `;

    const response = await this.graphql<{ issues: { nodes: any[] } }>(token, query, {
      limit: sanitizedLimit,
    });

    return response?.issues?.nodes ?? [];
  }

  async searchIssues(searchTerm: string, limit = 20): Promise<any[]> {
    const token = await this.getStoredToken();
    if (!token) {
      throw new Error('Linear token not set. Connect Linear in settings first.');
    }

    if (!searchTerm.trim()) {
      return [];
    }

    const sanitizedLimit = Math.min(Math.max(limit, 1), 200);

    // Get all recent issues and filter them locally
    // This ensures we can search through the issues we know exist
    const allIssuesQuery = `
      query ListAllIssues($limit: Int!) {
        issues(first: $limit, orderBy: updatedAt) {
          nodes {
            id
            identifier
            title
            url
            state { name type }
            team { name key }
            project { name }
            assignee { displayName name }
            updatedAt
          }
        }
      }
    `;

    try {
      const allIssuesResponse = await this.graphql<{ issues: { nodes: any[] } }>(
        token,
        allIssuesQuery,
        {
          limit: 100, // Get more issues to search through
        }
      );

      const allIssues = allIssuesResponse?.issues?.nodes ?? [];

      // Filter locally
      const searchTermLower = searchTerm.trim().toLowerCase();
      const filteredIssues = allIssues.filter((issue) => {
        // Search in identifier
        if (issue.identifier?.toLowerCase().includes(searchTermLower)) {
          return true;
        }
        // Search in title
        if (issue.title?.toLowerCase().includes(searchTermLower)) {
          return true;
        }
        // Search in assignee name
        if (issue.assignee?.name?.toLowerCase().includes(searchTermLower)) {
          return true;
        }
        // Search in assignee displayName
        if (issue.assignee?.displayName?.toLowerCase().includes(searchTermLower)) {
          return true;
        }
        return false;
      });

      // Return up to the requested limit
      return filteredIssues.slice(0, sanitizedLimit);
    } catch (error) {
      return [];
    }
  }

  private async fetchViewer(token: string): Promise<LinearViewer> {
    const query = `
      query ViewerInfo {
        viewer {
          name
          displayName
          organization {
            name
          }
        }
      }
    `;

    const data = await this.graphql<{ viewer: LinearViewer }>(token, query);
    if (!data?.viewer) {
      throw new Error('Unable to retrieve Linear account information.');
    }
    return data.viewer;
  }

  private async graphql<T>(
    token: string,
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const body = JSON.stringify({ query, variables });

    const requestPromise = new Promise<GraphQLResponse<T>>((resolve, reject) => {
      const url = new URL(LINEAR_API_URL);

      const req = request(
        {
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token,
            'Content-Length': Buffer.byteLength(body).toString(),
          },
        },
        (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              const parsed = JSON.parse(data) as GraphQLResponse<T>;
              resolve(parsed);
            } catch (error) {
              reject(error);
            }
          });
        }
      );

      req.on('error', (error) => {
        reject(error);
      });

      req.write(body);
      req.end();
    });

    const result = await requestPromise;

    if (result.errors?.length) {
      throw new Error(result.errors.map((err) => err.message).join('\n'));
    }

    if (!result.data) {
      throw new Error('Linear API returned no data.');
    }

    return result.data;
  }

  private async storeToken(token: string): Promise<void> {
    const clean = token.trim();
    if (!clean) {
      throw new Error('Linear token cannot be empty.');
    }

    try {
      const keytar = await import('keytar');
      await keytar.setPassword(this.SERVICE_NAME, this.ACCOUNT_NAME, clean);
    } catch (error) {
      console.error('Failed to store Linear token:', error);
      throw new Error('Unable to store Linear token securely.');
    }
  }

  private async getStoredToken(): Promise<string | null> {
    try {
      const keytar = await import('keytar');
      return await keytar.getPassword(this.SERVICE_NAME, this.ACCOUNT_NAME);
    } catch (error) {
      console.error('Failed to read Linear token from keychain:', error);
      return null;
    }
  }
}

export default LinearService;
