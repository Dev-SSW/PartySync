import { CalendarDays, ArrowUpRight, UsersRound } from 'lucide-react'
import { Link, Outlet } from 'react-router-dom'
import { useAuth } from '../features/member/Auth'
import { useAccount } from '../features/account/AccountAuth'
import { InstallHint } from '../components/InstallHint'
export function Layout() {
  const { sessions } = useAuth()
  const { ready } = useAccount()
  return (
    <>
      <header className="app-header">
        <div className="shell header-inner">
          <Link to="/" className="brand">
            <span className="brand-icon">
              <CalendarDays size={22} />
            </span>
            Party<span>Sync</span>
          </Link>
          <nav aria-label="주 메뉴">
            <Link className="button small" to={ready ? '/account' : '/login'}>{ready ? '내 계정' : '로그인'}</Link>
            <span className="header-note">
              <span className="status-dot" /> 함께할 시간을 찾다
            </span>
            <Link
              className="button small"
              to={sessions.length ? `/groups/${sessions.at(-1)!.groupId}` : '/join'}
            >
              <UsersRound size={16} />
              {sessions.length ? '내 파티' : '파티 참여'}
              <ArrowUpRight size={14} />
            </Link>
          </nav>
        </div>
      </header>
      <main className="shell">
        <InstallHint />
        <Outlet />
      </main>
      <footer className="shell footer">
        <span>PartySync</span>
        <span>
          같이 플레이할 시간, 더 쉽게. <span className="timezone">Asia/Seoul · KST</span>
        </span>
      </footer>
    </>
  )
}
