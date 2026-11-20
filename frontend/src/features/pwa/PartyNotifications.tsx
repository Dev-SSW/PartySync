import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { pushApi } from '../../api/push'
import { useGroupSession } from '../member/Auth'
import { applicationServerKey, pushSupport, readyServiceWorker } from './push'

/** 알림 권한은 사용자가 버튼을 눌렀을 때만 요청한다. 구독은 기기·파티별로 관리한다. */
export function PartyNotifications() {
  const { session, key } = useGroupSession()
  const support = pushSupport()
  const client = useQueryClient()
  const [message, setMessage] = useState('')
  const query = useQuery({
    queryKey: [...key, 'push'], enabled: support === 'ready', retry: false,
    queryFn: async () => {
      const config = await pushApi.configuration(session!)
      if (!config.enabled) return { ...config, subscribed: false }
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = await registration?.pushManager.getSubscription()
      const status = subscription ? await pushApi.status(session!, subscription.endpoint) : { subscribed: false }
      return { ...config, subscribed: status.subscribed }
    },
  })
  const action = useMutation({
    mutationFn: async () => {
      setMessage('')
      if (query.data?.subscribed) {
        const registration = await navigator.serviceWorker.getRegistration('/')
        const subscription = await registration?.pushManager.getSubscription()
        if (subscription) await pushApi.unsubscribe(session!, subscription.endpoint)
        // 다른 파티도 같은 브라우저 구독을 사용하므로 브라우저 구독 자체는 유지한다.
        setMessage('이 기기에서 이 파티의 일정 알림을 껐습니다.')
        return
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setMessage('알림 권한이 허용되지 않았어요. 기기의 앱·브라우저 설정에서 알림을 허용해 주세요.'); return }
      const registration = await readyServiceWorker()
      let subscription = await registration.pushManager.getSubscription()
      const serverKey = applicationServerKey(query.data!.publicKey)
      if (subscription?.options.applicationServerKey && !new Uint8Array(subscription.options.applicationServerKey).every((value, index) => value === serverKey[index])) {
        await subscription.unsubscribe(); subscription = null
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey })
      await pushApi.subscribe(session!, subscription.toJSON())
      setMessage('이 기기에서 파티원의 일정 알림을 받습니다.')
    },
    onSuccess: () => client.invalidateQueries({ queryKey: [...key, 'push'] }),
  })
  return <section className="card" aria-label="파티 일정 알림">
    <h2><Bell size={18} /> 일정 알림</h2>
    <p className="muted small-text">파티원이 일정을 등록·변경하면 이 기기로 알려드려요. 내 변경은 제외하고, 연속 변경은 모아서 보냅니다.</p>
    {support === 'install' ? <p className="muted small-text">앱을 홈 화면에 설치한 뒤 PartySync 아이콘으로 실행해 알림을 켜 주세요. iPhone은 iOS 16.4 이상에서 지원합니다.</p>
      : support === 'unsupported' ? <p className="muted small-text">이 환경에서는 푸시 알림을 지원하지 않습니다. 최신 브라우저에서 앱을 설치해 주세요.</p>
        : query.isPending ? <p className="muted small-text">알림 설정 확인 중…</p>
          : query.error ? <div><p className="feedback error">알림 설정을 불러오지 못했어요.</p><button className="button small" onClick={() => void query.refetch()}>알림 설정 다시 확인</button></div>
            : !query.data?.enabled ? <p className="muted small-text">아직 알림 서비스를 준비 중입니다.</p>
              : <button className="button small" disabled={action.isPending} onClick={() => action.mutate()}>{action.isPending ? '알림 설정 중…' : query.data.subscribed ? '이 파티 알림 끄기' : '이 파티 알림 켜기'}</button>}
    {message && <p className="feedback" role="status">{message}</p>}
    {action.error && <p className="feedback error" role="alert">알림을 설정하지 못했어요. 연결과 기기의 알림 권한을 확인한 뒤 다시 시도해 주세요.</p>}
  </section>
}
