import { ArrowRight, CalendarDays, Link2, UsersRound, Sparkles, Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../features/member/Auth'
export function Home() {
  const { sessions } = useAuth()
  return (
    <div className="home">
      <section className="hero">
        <div>
          <div className="eyebrow">
            <span className="status-dot" /> YOUR PARTY, IN SYNC
          </div>
          <h1>
            우리 파티,
            <br />
            언제 <span className="accent">모일 수 있을까?</span>
          </h1>
          <p className="hero-description">
            가능한 시간을 모으면, 함께할 시간이 보여요.
            <br />
            반복되는 일정부터 오늘의 변경까지 한곳에서 맞춰보세요.
          </p>
          <div className="actions">
            <Link className="button primary" to="/groups/new">
              새 파티 만들기 <ArrowRight size={18} />
            </Link>
            <Link className="button" to="/join">
              초대 코드로 참여
            </Link>
          </div>
          <p className="hint">
            <Check size={14} /> 회원가입 없이 시작 · 초대 링크로 간편하게
          </p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="sync-mark">
            <CalendarDays size={64} strokeWidth={1.25} />
            <span className="mini-check">
              <Check size={21} />
            </span>
          </div>
          <span className="floating-tag tag-one">
            <span className="status-dot" /> 일정은 유연하게
          </span>
          <span className="floating-tag tag-two">
            <UsersRound size={16} /> 우리 파티는 함께
          </span>
          <div className="art-caption">MAKE TIME. PLAY TOGETHER.</div>
        </div>
      </section>
      <section className="feature-grid" aria-label="주요 기능">
        {[
          {
            icon: CalendarDays,
            n: '01',
            title: '한 번 설정하는 주간 일정',
            text: '매주 가능한 시간을 등록해 두세요. 같은 요일에 자동으로 반영됩니다.',
          },
          {
            icon: Link2,
            n: '02',
            title: '링크 하나로 파티 완성',
            text: '가입 절차 없이 닉네임만으로 참여하고, 내 일정은 나만 관리해요.',
          },
          {
            icon: Sparkles,
            n: '03',
            title: '한눈에 보는 공통 시간',
            text: '시간대별 참여 인원을 확인하고, 모두 함께할 수 있는 시간을 찾아요.',
          },
        ].map(({ icon: Icon, n, title, text }) => (
          <article className="card feature" key={n}>
            <div className="feature-top">
              <Icon size={22} />
              <span>{n}</span>
            </div>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>
      {sessions.length > 0 && (
        <section className="saved-parties">
          <div className="section-head">
            <h2>이 브라우저의 파티</h2>
            <span className="muted small-text">저장된 참여 정보</span>
          </div>
          <div className="party-links">
            {sessions.map((s) => (
              <Link key={s.groupId} to={`/groups/${s.groupId}`} className="card party-link">
                <UsersRound size={20} />
                <span>{s.name}</span>
                <ArrowRight size={18} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
