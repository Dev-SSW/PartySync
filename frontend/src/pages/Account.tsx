import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { accountApi } from '../api/account'
import { api, ApiError } from '../api/client'
import { useAccount } from '../features/account/AccountAuth'
import { useAuth } from '../features/member/Auth'
import { Feedback, Loading } from '../components/Feedback'
import type { Session } from '../features/member/storage'

export function AccountForm({ registering = false }: { registering?: boolean }) {
  const [rememberLogin, setRememberLogin] = useState(true)
  const location = useLocation()
  const candidate = new URLSearchParams(location.search).get('returnTo')
  const returnTo = candidate?.startsWith('/join/') && !candidate.includes('//') ? candidate : '/account/groups'
  const [loginId, setLoginId] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState(''), [validation, setValidation] = useState('')
  const { accept, account, ready, restoring, error, retry } = useAccount(), { sessions } = useAuth(), navigate = useNavigate()
  const mutation = useMutation({ mutationFn: async () => {
    const response = await (registering ? accountApi.register(loginId, password, rememberLogin) : accountApi.login(loginId, password, rememberLogin))
    accept(response); setPassword(''); setConfirm('')
  }, onSuccess: () => navigate(returnTo, { replace: true }) })
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!/^[a-z0-9][a-z0-9_]{3,31}$/.test(loginId.trim().toLowerCase()) || password.length < 12 || new TextEncoder().encode(password).length > 72 || password.includes('\0') || !password.trim() || (registering && password !== confirm)) {
      setValidation('아이디 형식과 비밀번호를 확인하세요. 비밀번호는 12자 이상, UTF-8 72바이트 이하이며 확인 값이 같아야 합니다.'); return
    }
    if (!mutation.isPending) { setValidation(''); mutation.mutate() }
  }
  if (restoring || (account && !ready && !error)) return <Loading />
  if (account && !ready && error) return <Feedback error={error} retry={retry} />
  if (ready) return <section className="page narrow"><h1>계정에 로그인되어 있어요</h1><Link className="button primary" to={returnTo === '/account/groups' ? '/account' : returnTo}>내 계정 보기</Link><p>다른 계정으로 전환하려면 먼저 로그아웃해 주세요.</p></section>
  return <section className="page narrow"><h1>{registering ? '계정 만들기' : '로그인'}</h1><p className="muted">다른 기기에서도 연결한 파티의 기존 멤버로 다시 입장하세요.</p>{registering && sessions.some(s => !s.accountUserId) && <p className="feedback">가입 후 이 브라우저의 비회원 파티를 연결할 수 있어요. 일정과 작성 글은 유지됩니다.</p>}<form className="card form-card" onSubmit={submit}>
    <label>로그인 ID<input autoComplete="username" required minLength={4} maxLength={32} value={loginId} onChange={e => setLoginId(e.target.value)} disabled={mutation.isPending} /></label><p className="muted small-text">영문 소문자·숫자·밑줄 4~32자. 첫 글자는 영문 또는 숫자이며 대소문자는 구분하지 않습니다.</p>
    <label>비밀번호<input type="password" autoComplete={registering ? 'new-password' : 'current-password'} required minLength={12} maxLength={72} value={password} onChange={e => setPassword(e.target.value)} disabled={mutation.isPending} /></label>
    {registering && <label>비밀번호 확인<input type="password" autoComplete="new-password" required maxLength={72} value={confirm} onChange={e => setConfirm(e.target.value)} disabled={mutation.isPending} /></label>}
    <p className="muted small-text">12자 이상, UTF-8 72바이트 이하. 한글은 보통 한 글자당 3바이트입니다. 비밀번호 찾기는 제공하지 않으니 안전하게 보관해 주세요.</p>
    {validation && <p role="alert" className="feedback error">{validation}</p>}{mutation.error instanceof ApiError && mutation.error.status === 401 ? <p role="alert" className="feedback error">아이디 또는 비밀번호를 확인해 주세요.</p> : mutation.error && <Feedback error={mutation.error} />}<button className="button primary" disabled={mutation.isPending}>{mutation.isPending ? '처리 중…' : registering ? '계정 등록' : '로그인'}</button>
    <label className="remember-login"><input type="checkbox" checked={rememberLogin} onChange={e => setRememberLogin(e.target.checked)} />로그인 유지</label>
    <Link to={`${registering ? '/login' : '/register'}${location.search}`}>{registering ? '이미 계정이 있나요? 로그인' : '계정 만들기'}</Link></form></section>
}

export function AccountPage() {
  const { account, credentials, ready, restoring, error, logout, retry } = useAccount()
  const { sessions, remember, forget } = useAuth(), navigate = useNavigate(), client = useQueryClient(), location = useLocation()
  const groups = useQuery({ queryKey: ['account', account?.revision, 'groups'], queryFn: () => accountApi.groups(credentials!), enabled: ready })
  const action = useMutation({ mutationFn: async (operation: { kind: 'enter'; groupId: number } | { kind: 'claim'; session: Session } | { kind: 'leave'; session: Session } | { kind: 'logout' }) => {
    if (operation.kind === 'logout') { await logout(); navigate('/login'); return }
    if (operation.kind === 'leave') { await accountApi.logoutMember(operation.session); forget(operation.session.groupId); return }
    if (operation.kind === 'claim') {
      // 저장된 이름도 서버의 현재 토큰 정보와 대조하고 사용자가 실제 소유한 비회원만 연결한다.
      const guest = await api.me(operation.session)
      if (guest.groupId !== operation.session.groupId) throw new Error('Membership mismatch')
    }
    const result = operation.kind === 'enter' ? await accountApi.enter(credentials!, operation.groupId) : await accountApi.claim(credentials!, operation.session.token)
    await remember(result, undefined, account!.user.userId)
    await client.invalidateQueries({ queryKey: ['account', account!.revision, 'groups'] })
    if (operation.kind === 'enter') navigate(`/groups/${result.group.groupId}`)
  } })
  if (restoring) return <Loading />
  if (!account && error) return <section className="page narrow"><Feedback error={error} retry={retry} /></section>
  if (!account) return <section className="page narrow"><h1>계정 로그인이 필요해요</h1><Link className="button primary" to="/login">로그인</Link><Link className="button" to="/register">계정 만들기</Link><p className="muted">비회원 참여 정보는 그대로 유지됩니다.</p></section>
  if (!ready) return <section className="page narrow">{error ? <Feedback error={error} retry={retry} /> : <Loading />}</section>
  const guests = sessions.filter(s => !s.accountUserId)
  return <section className="page account-page"><div className="section-head"><div><div className="eyebrow">MY ACCOUNT</div><h1>내 계정과 파티</h1><p>{account.user.loginId}</p></div><button className="button" disabled={action.isPending} onClick={() => action.mutate({ kind: 'logout' })}>이 기기 로그아웃</button></div>
    <p className="muted">로그인 유지를 선택하면 이 브라우저에서 로그인을 복원합니다. 공용 기기에서는 사용 후 로그아웃하세요. 다른 브라우저에는 인증 정보가 공유되지 않습니다.</p>
    {location.search.includes('linkFailed') && <p role="alert" className="feedback error">파티는 생성·참여되었지만 계정 연결을 완료하지 못했어요. 비회원 참여 정보는 보관되어 있으니 아래에서 다시 연결하거나 기존 계정 파티로 입장하세요.</p>}
    {action.error && <Feedback error={action.error} />}
    <section className="card"><h2>계정에 연결된 파티</h2>{groups.isPending ? <Loading /> : groups.error ? <Feedback error={groups.error} retry={() => void groups.refetch()} /> : groups.data.length ? <ul className="account-groups">{groups.data.map(group => <li key={group.groupId}><div><strong>{group.groupName}</strong><p className="muted">{group.nickname} · {group.role === 'OWNER' ? '파티장' : '파티원'}</p></div><div className="actions"><button className="button primary" disabled={action.isPending} onClick={() => action.mutate({ kind: 'enter', groupId: group.groupId })}>파티 입장</button>{sessions.some(s => s.groupId === group.groupId && s.accountUserId === account.user.userId) && <button className="button small" disabled={action.isPending} onClick={() => action.mutate({ kind: 'leave', session: sessions.find(s => s.groupId === group.groupId)! })}>그룹 세션 로그아웃</button>}</div></li>)}</ul> : <p className="muted">연결된 파티가 없습니다. 아래의 비회원 파티를 연결하거나 새 파티에 참여하세요.</p>}</section>
    {guests.length > 0 && <section className="card"><h2>이 브라우저의 비회원 파티 연결</h2><p className="muted">연결하면 기존 비회원 토큰은 폐기되고 이 계정으로만 복구할 수 있습니다. 닉네임·일정·게시글은 유지됩니다.</p><ul className="account-groups">{guests.map(s => <li key={s.groupId}><div><strong>{s.name}</strong><Link className="board-text-link" to={`/groups/${s.groupId}`}>연결 대상 확인</Link></div><button className="button" disabled={action.isPending} onClick={() => { if (window.confirm(`${s.name}의 현재 멤버를 ${account.user.loginId} 계정에 연결할까요?`)) action.mutate({ kind: 'claim', session: s }) }}>계정에 연결하기</button></li>)}</ul></section>}
    <div className="actions wrap"><Link className="button" to="/groups/new">새 파티 만들기</Link><Link className="button" to="/join">초대 링크로 참여</Link></div><p className="muted small-text">이메일·비밀번호 찾기는 아직 제공하지 않습니다. 비회원 토큰을 잃고 계정에도 연결하지 않았다면 닉네임만으로 복구할 수 없습니다.</p>
  </section>
}
