import { request, type Credentials } from './client'

const base = '/members/me/push'
export const pushApi = {
  configuration: (auth: Credentials) => request<{ enabled: boolean; publicKey: string }>(`${base}/configuration`, { auth }),
  status: (auth: Credentials, endpoint: string) => request<{ subscribed: boolean }>(`${base}/status`, { auth, method: 'POST', body: { endpoint } }),
  subscribe: (auth: Credentials, subscription: PushSubscriptionJSON) => request<void>(`${base}/subscription`, { auth, method: 'PUT', body: subscription }),
  unsubscribe: (auth: Credentials, endpoint: string) => request<void>(`${base}/subscription`, { auth, method: 'DELETE', body: { endpoint } }),
}
