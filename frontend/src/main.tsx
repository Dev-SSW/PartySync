import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthProvider } from './features/member/Auth'
import './styles.css'
import { registerServiceWorker } from './features/pwa/push'
import { appUpdates } from './features/pwa/appUpdates'

appUpdates.start()

if ('serviceWorker' in navigator && window.isSecureContext !== false) {
  void registerServiceWorker().catch(() => { /* 알림 설정 화면에서 등록을 다시 시도할 수 있다. */ })
}

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 10_000 }, mutations: { retry: false } },
})
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
