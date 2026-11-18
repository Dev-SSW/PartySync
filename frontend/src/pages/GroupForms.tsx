import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Link2, ShieldCheck } from 'lucide-react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import { Feedback, Loading } from '../components/Feedback'
import { useAuth } from '../features/member/Auth'
import { inviteHash } from '../features/member/storage'
import { normalizeInvite } from '../utils/invite'
import type { Membership } from '../types/api'
import { useAccount } from '../features/account/AccountAuth'
import { accountApi } from '../api/account'

export function GroupForm({ mode }: { mode: 'create' | 'join' }) {
  const creating = mode === 'create'
  const { inviteCode } = useParams()
  const [name, setName] = useState(''),
    [nickname, setNickname] = useState(''),
    [description, setDescription] = useState('')
  const [code, setCode] = useState(inviteCode || ''),
    [validation, setValidation] = useState('')
  const [unsaved, setUnsaved] = useState<{ data: Membership; code?: string } | null>(null)
  const [storageError, setStorageError] = useState(false)
  const { remember, sessions } = useAuth()
  const account = useAccount()
  const navigate = useNavigate()
  const [existing, setExisting] = useState<number | null>(null)
  /** 보관된 토큰으로 기존 참여 여부를 확인한다. */
  async function findStored(normalized: string) {
    const hash = await inviteHash(normalized)
    const candidates = sessions.filter(s => s.inviteHash === hash || !s.inviteHash)
    for (const stored of candidates) {
      try {
        if (stored.inviteHash === hash) { await api.me(stored); return stored.groupId }
        // 초대 해시가 없는 예전 참여 정보는 서버에서 해당 그룹의 초대인지 확인한다.
        if ((await api.checkInvite(stored, normalized)).matches) return stored.groupId
      } catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error }
    }
    return null
  }
  // 초대 링크에서는 새 가입 전에 비회원 정보와 계정 멤버를 먼저 복원한다.
  const resume = useQuery({
    queryKey: ['invite-resume', code, account.account?.revision],
    enabled: !creating && !!inviteCode && !account.restoring && (!account.account || account.ready), retry: false,
    queryFn: async () => {
      const normalized = normalizeInvite(code)
      const stored = await findStored(normalized)
      if (stored) return stored
      if (account.credentials && account.ready) {
        try {
          const membership = await accountApi.resumeInvite(account.credentials, normalized)
          await remember(membership, normalized, account.account!.user.userId)
          return membership.group.groupId
        } catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error }
      }
      return null
    },
  })
  useEffect(() => { if (resume.data) navigate(`/groups/${resume.data}`, { replace: true }) }, [resume.data, navigate])
  useEffect(() => {
    if (inviteCode !== undefined) setCode(inviteCode)
  }, [inviteCode])
  useEffect(() => {
    let active = true
    setExisting(null)
    let normalized = ''
    try {
      normalized = normalizeInvite(code)
    } catch {
      /* 입력 중인 링크는 아직 유효하지 않을 수 있습니다. */
    }
    if (!creating && normalized)
      void inviteHash(normalized).then((hash) => {
        if (active) setExisting(sessions.find((s) => s.inviteHash === hash)?.groupId || null)
      })
    return () => {
      active = false
    }
  }, [creating, code, sessions])
  async function finish(data: Membership, invitation?: string) {
    // 발급 성공 후 저장 실패한 경우 재가입 대신 같은 응답의 토큰 저장을 다시 시도합니다.
    setUnsaved({ data, code: invitation })
    try {
      await remember(data, invitation)
      if (account.ready && account.credentials) {
        try {
          const linked = await accountApi.claim(account.credentials, data.memberAccessToken)
          await remember(linked, invitation, account.account!.user.userId)
        } catch {
          // 먼저 비회원 토큰을 저장했으므로 연결 실패 시에도 가입 정보를 잃지 않는다.
          navigate('/account?linkFailed=1', { replace: true })
          return
        }
      }
      navigate(`/groups/${data.group.groupId}`, { replace: true })
    } catch {
      setStorageError(true)
    }
  }
  const mutation = useMutation({
    mutationFn: async () => {
      if (!creating) {
        const stored = await findStored(normalizeInvite(code))
        if (stored) { navigate(`/groups/${stored}`, { replace: true }); return }
      }
      if (!creating && account.ready && account.credentials) {
        try {
          const membership = await accountApi.resumeInvite(account.credentials, normalizeInvite(code))
          await remember(membership, normalizeInvite(code), account.account!.user.userId)
          navigate(`/groups/${membership.group.groupId}`, { replace: true }); return
        } catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error }
      }
      const data = await (creating
        ? api.create({
            name: name.trim(),
            description: description.trim(),
            ownerNickname: nickname.trim(),
          })
        : api.join({ inviteCode: normalizeInvite(code), nickname: nickname.trim() }))
      // 발급 응답은 인증 모듈에 전달하고 Mutation 캐시에 토큰 원문을 남기지 않습니다.
      await finish(data, creating ? data.inviteCode : normalizeInvite(code))
    },
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!nickname.trim() || (creating && !name.trim()) || (!creating && !code.trim())) {
      setValidation('필수 항목을 입력해 주세요. 공백만 사용할 수 없습니다.')
      return
    }
    if (!creating) {
      try {
        normalizeInvite(code)
      } catch (error) {
        setValidation((error as Error).message)
        return
      }
    }
    if (resume.data) {
      navigate(`/groups/${resume.data}`)
      return
    }
    setValidation('')
    mutation.mutate()
  }
  return (
    <section className="narrow page">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} /> 처음으로
      </Link>
      <div className="page-icon">{creating ? <ShieldCheck size={27} /> : <Link2 size={27} />}</div>
      <div className="eyebrow">{creating ? 'CREATE YOUR PARTY' : 'JOIN THE PARTY'}</div>
      <h1>{creating ? '함께할 파티를 만들어보세요' : '이제, 파티에 합류하세요'}</h1>
      <p className="muted">
        {creating
          ? '파티를 만들면 초대 링크를 공유할 수 있어요.'
          : '초대받은 코드와 파티에서 사용할 닉네임만 있으면 돼요.'}
      </p>
      {!creating && !!inviteCode && (account.restoring || (account.account && !account.ready && !account.error) || (resume.isFetching)) ? <Loading /> : !creating && (resume.error || account.error) ? <Feedback error={resume.error || account.error} retry={() => { account.retry(); void resume.refetch() }} /> : <form className="card form-card" onSubmit={submit}>
        {creating ? (
          <>
            <label>
              그룹 이름 <span className="required">*</span>
              <input
                autoFocus
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 금요일 저녁 레이드"
              />
            </label>
            <label>
              그룹 소개 <span className="muted">선택</span>
              <textarea
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="우리 파티를 간단히 소개해 주세요"
                rows={3}
              />
            </label>
          </>
        ) : (
          <label>
            초대 코드 또는 초대 링크 <span className="required">*</span>
            <input
              required
              maxLength={2048}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="초대 코드 또는 전체 초대 링크를 붙여넣으세요"
              readOnly={!!inviteCode}
            />
          </label>
        )}
        <label>
          내 닉네임 <span className="required">*</span>
          <input
            required
            maxLength={50}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            autoComplete="nickname"
            placeholder="파티원들에게 보여질 이름"
          />
        </label>
        {validation && (
          <p className="feedback error" role="alert">
            {validation}
          </p>
        )}
        {mutation.error && <Feedback error={mutation.error} />}
        {storageError && (
          <div role="alert" className="feedback error">
            참여는 완료되었지만 브라우저 저장이 차단되었습니다. 저장을 허용한 후 아래 버튼을 눌러
            주세요. 페이지를 닫으면 인증 정보를 잃습니다.
          </div>
        )}
        {existing && (
          <div className="feedback success">
            이미 이 브라우저에서 참여한 파티예요.{' '}
            <Link to={`/groups/${existing}`}>파티로 이동</Link>
          </div>
        )}
        {unsaved && storageError ? (
          <button
            type="button"
            className="button primary full"
            onClick={() => void finish(unsaved.data, unsaved.code)}
          >
            참여 정보 저장 다시 시도
          </button>
        ) : (
          <button className="button primary full" disabled={mutation.isPending || !!unsaved || account.restoring || (!!account.account && !account.ready)}>
            {mutation.isPending
              ? '처리 중…'
              : creating
                ? '파티 만들기'
                : existing
                  ? '참여한 파티로 이동'
                  : '파티 참여하기'}
            <ArrowRight size={17} />
          </button>
        )}
      </form>}
      {!creating && !account.ready && <p className="muted"><Link to={`/login?returnTo=${encodeURIComponent(`/join/${code}`)}`}>계정에 연결한 기존 파티로 로그인</Link></p>}
      <p className="security-note">
        <ShieldCheck size={16} /> 이 브라우저에 참여 정보가 저장됩니다. 공용 기기 사용에 주의해
        주세요. 다른 브라우저에서 복구하려면 계정 연결이 필요할 수 있어요.
      </p>
    </section>
  )
}
