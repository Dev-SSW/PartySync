import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { UsersRound } from 'lucide-react'
import { Feedback, Loading } from '../../components/Feedback'
import { useAccount } from '../account/AccountAuth'
import { useDefaultParty } from './defaultPartyStorage'
import { accessDenied, usePartyList, type Party } from './usePartyList'
import { usePartyEntry } from './usePartyEntry'

/** 홈에서도 계정 파티를 서버에서 조회하고 비회원 파티와 함께 표시한다. */
export function HomeParties() {
  const account = useAccount(), list = usePartyList(), enter = usePartyEntry(), navigate = useNavigate()
  const defaults = useDefaultParty(account.account?.user.userId, !account.restoring && (!account.account || account.ready))
  const [storageError, setStorageError] = useState(false)
  const entry = useMutation({ mutationFn: (party: Party) => enter(party),
    onSuccess: id => navigate(`/groups/${id}`), onError: error => { if (accessDenied(error)) list.retry() } })
  function setDefault(id: number | null) {
    try { defaults.set(id); setStorageError(false) }
    catch { setStorageError(true) }
  }
  return <section className="saved-parties" aria-label="내 파티">
    <div className="section-head"><h2>내 파티</h2><span className="muted small-text">계정 연결 · 이 브라우저의 참여 정보</span></div>
    {list.waiting && <Loading />}
    {list.error && <Feedback error={list.error} retry={list.retry} />}
    {entry.error && <Feedback error={entry.error} />}
    {storageError && <p className="feedback error" role="alert">기본 파티를 저장하지 못했습니다. 브라우저 저장 설정을 확인하고 다시 선택해 주세요.</p>}
    <div className="party-links">
      {list.parties.map(party => <article className="card home-party" key={party.groupId} aria-label={party.name}>
        <div className="home-party-heading"><UsersRound size={20} /><h3>{party.name}</h3>{defaults.id === party.groupId && <span className="badge">기본 파티</span>}</div>
        <p className="muted">{party.nickname} · {party.role === 'OWNER' ? '파티장' : '파티원'} · {party.kind === 'account' ? '계정 연결' : '비회원'}</p>
        <div className="actions wrap">
          <button className="button primary small" disabled={entry.isPending} onClick={() => entry.mutate(party)}>파티 입장</button>
          <button className="button small" disabled={account.restoring || (!!account.account && !account.ready)}
            onClick={() => setDefault(defaults.id === party.groupId ? null : party.groupId)}>
            {defaults.id === party.groupId ? '기본 파티 해제' : '기본 파티로 설정'}
          </button>
        </div>
      </article>)}
    </div>
    {!list.waiting && !list.error && !list.parties.length && <p className="muted">아직 참여한 파티가 없습니다. 초대 링크로 참여하거나 {account.ready
      ? <Link className="board-text-link" to="/groups/new">새 파티를 만들어</Link>
      : <Link className="board-text-link" to="/login">계정에 로그인</Link>} 주세요.</p>}
    <p className="muted small-text home-party-hint">기본 파티는 이 브라우저·계정에 저장되며, 설치한 앱을 실행할 때 열립니다. 다른 브라우저에서는 다시 지정해 주세요.</p>
  </section>
}
