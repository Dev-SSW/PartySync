import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  UsersRound,
  ArrowRight,
  LogOut,
  Crown,
} from 'lucide-react'
import { api, isTemporaryError } from '../api/client'
import { useAuth, useGroupSession } from '../features/member/Auth'
import { Feedback, Loading } from '../components/Feedback'
import { AvailabilityWorkspace } from '../features/availability/AvailabilityWorkspace'
import { OverrideEditor } from '../features/availability/OverrideEditor'
import { LatestPosts } from '../features/board/LatestPosts'
import { PartyNotifications } from '../features/pwa/PartyNotifications'
import { pushApi } from '../api/push'
import { addDays, monday, seoulToday } from '../utils/schedule'

export function Dashboard() {
  const client = useQueryClient()
  const { session, me, key } = useGroupSession()
  const remove = useMutation({ mutationFn: (id: number) => api.removeMember(session!, id), onSuccess: async () => { await client.invalidateQueries({ queryKey: ['group', session!.groupId] }) } })
  const { forget } = useAuth()
  const navigate = useNavigate()
  const [week, setWeek] = useState(() => monday(seoulToday()))
  const [calendarBusy, setCalendarBusy] = useState(false)
  const [forgetting, setForgetting] = useState(false), [forgetError, setForgetError] = useState(false)
  async function forgetThisDevice() {
    if (!window.confirm('이 기기의 참여 정보와 이 파티의 알림 설정을 지울까요? 계정에 연결한 파티는 로그인 후 다시 입장할 수 있습니다. 비회원은 참여 정보를 복구할 수 없을 수 있습니다.')) return
    setForgetting(true); setForgetError(false)
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration('/')
        const subscription = await registration?.pushManager?.getSubscription()
        if (subscription) await pushApi.unsubscribe(session!, subscription.endpoint)
      }
      forget(session!.groupId); navigate('/')
    } catch { setForgetError(true) }
    finally { setForgetting(false) }
  }
  const to = addDays(week, 6)
  const [editDate, setEditDate] = useState<string | null>(null)
  const [inviteRequested, setInviteRequested] = useState(false),
    [copied, setCopied] = useState<'link' | 'code' | null>(null),
    [copyFailed, setCopyFailed] = useState(false)
  const group = useQuery({ queryKey: [...key, 'details'], queryFn: () => api.group(session!) })
  const members = useQuery({ queryKey: [...key, 'members'], queryFn: () => api.members(session!) })
  const availability = useQuery({
    queryKey: [...key, 'availability', week],
    queryFn: () => api.availability(session!, week, to),
  })
  const common = useQuery({
    queryKey: [...key, 'common', week],
    queryFn: () => api.common(session!, week, to),
  })
  const isOwner = me.data?.role === 'OWNER'
  const invite = useQuery({
    queryKey: [...key, 'invite'],
    queryFn: () => api.invite(session!),
    enabled: isOwner && inviteRequested,
    staleTime: 60_000,
  })
  const own = availability.data?.days
    .find((d) => d.date === editDate)
    ?.members.find((m) => m.memberId === me.data?.memberId)
  async function copyInvite(kind: 'link' | 'code') {
    setInviteRequested(true)
    setCopyFailed(false)
    try {
      // Clipboard API는 사용자 클릭 직후에 호출해야 하는 브라우저가 있어 실패 시 수동 복사를 제공합니다.
      const result = invite.data || (await invite.refetch()).data
      if (!result) return
      await navigator.clipboard.writeText(
        kind === 'code'
          ? result.inviteCode
          : `${window.location.origin}/join/${encodeURIComponent(result.inviteCode)}`,
      )
      setCopied(kind)
    } catch {
      setCopyFailed(true)
    }
  }
  const dataError = availability.error || common.error
  if (group.isPending || members.isPending) return <Loading />
  if (
    !group.data ||
    !members.data ||
    (group.error && !isTemporaryError(group.error)) ||
    (members.error && !isTemporaryError(members.error))
  )
    return (
      <div className="page">
        <Feedback
          error={group.error || members.error}
          retry={() => {
            void group.refetch()
            void members.refetch()
          }}
        />
      </div>
    )
  return (
    <section className="page dashboard">
      {(group.error || members.error) && (
        <Feedback
          error={group.error || members.error}
          retry={() => {
            void group.refetch()
            void members.refetch()
          }}
        />
      )}
      <div className="breadcrumb">
        <Link to="/">내 파티</Link>
        <span>/</span>
        <span>{group.data.name}</span>
      </div>
      <div className="section-head dashboard-heading">
        <div>
          <div className="eyebrow">
            <span className="status-dot" /> PARTY SPACE
          </div>
          <h1>{group.data.name}</h1>
          <p className="muted group-description">
            {group.data.description || '함께할 시간을 맞춰보세요.'}
          </p>
        </div>
        <div className="actions wrap">
          <span className="identity">
            <span className="avatar">{me.data?.nickname.slice(0, 1)}</span>
            <strong>{me.data?.nickname}</strong>
            <span className="badge">{isOwner ? '파티장' : '멤버'}</span>
          </span>
          {isOwner && (
            <>
              <button
                className="button"
                onClick={() => void copyInvite('link')}
                disabled={invite.isFetching}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied === 'link' ? '초대 링크 복사됨' : '초대 링크 복사'}
              </button>
              <button
                className="button"
                disabled={invite.isFetching}
                onClick={() => void copyInvite('code')}
              >
                {copied === 'code' ? '초대 코드 복사됨' : '초대 코드 복사'}
              </button>
            </>
          )}
        </div>
      </div>
      {invite.error && <Feedback error={invite.error} />}
      {copyFailed && invite.data && (
        <div className="feedback">
          <label className="full">
            자동 복사가 지원되지 않습니다. 링크를 선택해 복사하세요.
            <input
              aria-label="초대 링크 수동 복사"
              readOnly
              value={`${window.location.origin}/join/${encodeURIComponent(invite.data.inviteCode)}`}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <label className="full">
            초대 코드
            <input
              aria-label="초대 코드 수동 복사"
              readOnly
              value={invite.data.inviteCode}
              onFocus={(e) => e.target.select()}
            />
          </label>
        </div>
      )}
      <div className="dashboard-layout">
        <div className="calendar-column">
          <div className="card calendar-card">
            <div className="section-head calendar-title">
              <div className="actions">
                <span className="page-icon small-icon">
                  <CalendarDays size={21} />
                </span>
                <div>
                  <h2>우리 파티 시간표</h2>
                  <p className="small-text muted">가능한 시간을 모아, 함께할 시간을 찾아요</p>
                </div>
              </div>
              <Link className="button small" to={`/groups/${session!.groupId}/schedule/weekly`}>
                내 반복 일정 설정 <ArrowRight size={15} />
              </Link>
            </div>
            <div className="week-navigation">
              <div className="actions">
                <button
                  className="icon-button"
                  aria-label="이전 주"
                  disabled={calendarBusy}
                  onClick={() => {
                    setWeek(addDays(week, -7))
                    setEditDate(null)
                  }}
                >
                  <ChevronLeft size={19} />
                </button>
                <strong>
                  {week.replaceAll('-', '.')} <span className="muted">—</span>{' '}
                  {to.slice(5).replace('-', '.')}
                </strong>
                <button
                  className="icon-button"
                  aria-label="다음 주"
                  disabled={calendarBusy}
                  onClick={() => {
                    setWeek(addDays(week, 7))
                    setEditDate(null)
                  }}
                >
                  <ChevronRight size={19} />
                </button>
              </div>
              <button
                className="button small"
                disabled={calendarBusy}
                onClick={() => setWeek(monday(seoulToday()))}
              >
                이번 주
              </button>
            </div>
            {dataError && availability.data && common.data && (
              <Feedback
                error={dataError}
                retry={() => {
                  void availability.refetch()
                  void common.refetch()
                }}
              />
            )}
            {dataError && (!availability.data || !common.data) ? (
              <Feedback
                error={dataError}
                retry={() => {
                  void availability.refetch()
                  void common.refetch()
                }}
              />
            ) : availability.isPending || common.isPending ? (
              <Loading />
            ) : (
              <AvailabilityWorkspace
                key={session!.revision + week}
                onBusy={setCalendarBusy}
                common={common.data!}
                availability={availability.data!}
                members={members.data}
                memberId={me.data!.memberId}
                onEdit={setEditDate}
              />
            )}
          </div>
          <p className="calendar-footnote">
            모든 시간은 한국 표준시(KST)입니다. 날짜를 누르면 내 예외 일정을 설정할 수 있어요.
          </p>
        </div>
        <aside className="sidebar">
          <PartyNotifications key={me.data!.memberId} memberId={me.data!.memberId} />
          <LatestPosts />
          <details className="card member-card">
            <summary className="compact-members-summary">
              파티원 {group.data.memberCount}명 · 내 정보: {me.data!.nickname}
            </summary>
            <div className="section-head">
              <h2>
                <UsersRound size={18} /> 파티원
              </h2>
              <span className="badge">{group.data.memberCount}명</span>
            </div>
            <ul className="member-list">
              {members.data.map((member) => (
                <li key={member.memberId}>
                  <span className={`avatar ${member.role === 'OWNER' ? 'owner' : ''}`}>
                    {member.nickname.slice(0, 1)}
                  </span>
                  <div>
                    <strong>
                      {member.nickname}
                      {member.memberId === me.data!.memberId && (
                        <span className="you-label">나</span>
                      )}
                    </strong>
                    <span className="small-text muted">
                      {member.role === 'OWNER' ? '파티장' : '멤버'}
                    </span>
                  </div>
                  {member.role === 'OWNER' && <Crown size={16} className="crown" />}
                  {isOwner && member.role !== 'OWNER' && member.memberId !== me.data!.memberId && <button className="button small" disabled={remove.isPending} onClick={() => { if (window.confirm(`${member.nickname}님을 강퇴할까요? 일정과 참여 정보는 삭제되고 게시글은 탈퇴한 사용자 명의로 남습니다. 초대 링크로 같은 닉네임을 사용해 새로 참여할 수 있습니다.`)) remove.mutate(member.memberId) }}>강퇴</button>}
                </li>
              ))}
            </ul>
            {remove.error && <Feedback error={remove.error} />}
            {remove.isSuccess && <p role="status">파티원을 강퇴했습니다.</p>}
          </details>
          <details className="card guide-card">
            <summary>시간표 사용 안내</summary>
            <span className="eyebrow">QUICK GUIDE</span>
            <h3>일정, 이렇게 맞춰요</h3>
            <ol>
              <li>
                <strong>내 반복 일정 설정</strong>
                <span>매주 가능한 시간을 선택하세요.</span>
              </li>
              <li>
                <strong>이번 주에만 다르다면?</strong>
                <span>날짜를 눌러 예외를 설정하세요.</span>
              </li>
              <li>
                <strong>모두 가능한 시간 찾기</strong>
                <span>전원 가능 표시와 인원수를 확인하세요.</span>
              </li>
            </ol>
          </details>
          <button
            className="leave-button"
            disabled={calendarBusy || forgetting}
            onClick={() => void forgetThisDevice()}
          >
            <LogOut size={14} /> 이 기기에서 참여 정보 지우기
          </button>
          {forgetError && <p role="alert" className="feedback error">알림 해제와 참여 정보 삭제를 완료하지 못했어요. 연결을 확인하고 다시 시도해 주세요.</p>}
        </aside>
      </div>
      {editDate && own && (
        <OverrideEditor
          key={editDate}
          date={editDate}
          current={own}
          onClose={() => setEditDate(null)}
        />
      )}
    </section>
  )
}
