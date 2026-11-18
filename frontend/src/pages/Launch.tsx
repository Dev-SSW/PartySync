import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Feedback, Loading } from '../components/Feedback'
import { useAccount } from '../features/account/AccountAuth'
import { useDefaultParty } from '../features/party/defaultPartyStorage'
import { accessDenied, usePartyList } from '../features/party/usePartyList'
import { usePartyEntry } from '../features/party/usePartyEntry'

/** PWA 시작 경로에서만 기본 파티를 검증하고 자동 입장한다. */
export function Launch() {
  const account = useAccount(), navigate = useNavigate(), enter = usePartyEntry()
  const accountWaiting = account.restoring || (!!account.account && !account.ready && !account.error)
  const defaults = useDefaultParty(account.account?.user.userId, !accountWaiting && !account.error)
  const list = usePartyList({ enabled: defaults.id !== null, guestGroupId: defaults.id })
  const [storageError, setStorageError] = useState(false)
  const party = list.parties.find(party => party.groupId === defaults.id)
  const entry = useQuery({ queryKey: ['launch-entry', account.account?.user.userId || 'guest', defaults.id],
    queryFn: () => enter(party!), enabled: !accountWaiting && !list.waiting && !list.error && !!party,
    retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false,
  })
  useEffect(() => {
    if (accountWaiting || list.waiting || list.error || storageError) return
    if (!defaults.id) { navigate('/', { replace: true }); return }
    if (!party || accessDenied(entry.error)) {
      try { defaults.set(null); navigate('/', { replace: true }) }
      catch { setStorageError(true) }
    } else if (entry.isSuccess && !entry.isFetching) navigate(`/groups/${entry.data}`, { replace: true })
  }, [accountWaiting, list.waiting, list.error, storageError, defaults, party, entry.error, entry.isSuccess, entry.isFetching, entry.data, navigate])
  if (storageError) return <section className="page narrow"><p role="alert">기본 파티 설정을 정리하지 못했습니다. 브라우저 저장 설정을 확인해 주세요.</p><Link className="button" to="/">메인 화면으로</Link></section>
  const error = list.error || entry.error
  return <section className="page narrow" aria-label="기본 파티 실행">
    {error && !accessDenied(error) ? <><Feedback error={error} retry={() => { if (list.error) list.retry(); else void entry.refetch() }} /><Link className="button" to="/">메인 화면으로</Link></> : <Loading />}
  </section>
}
