import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Settings2 } from 'lucide-react'
import { boardApi } from '../api/board'
import { api, isTemporaryError } from '../api/client'
import { useGroupSession } from '../features/member/Auth'
import { Feedback, Loading } from '../components/Feedback'
import { postDate, refreshPosts } from '../features/board/queries'
import { TextWithLinks } from '../features/board/TextWithLinks'
import { useUnsaved } from '../hooks/useUnsaved'
import type { PostDetails } from '../features/board/types'

export function PostList() {
  const { session, me, key } = useGroupSession()
  const [params, setParams] = useSearchParams()
  const rawPage = Number(params.get('page') || 0), rawCategory = Number(params.get('categoryId') || 0)
  const page = Number.isSafeInteger(rawPage) && rawPage >= 0 && rawPage <= 10000000 ? rawPage : 0
  const categoryId = Number.isSafeInteger(rawCategory) && rawCategory > 0 ? rawCategory : undefined
  const categories = useQuery({ queryKey: [...key, 'board', 'categories'], queryFn: () => boardApi.categories(session!) })
  const group = useQuery({ queryKey: [...key, 'details'], queryFn: () => api.group(session!) })
  const posts = useQuery({ queryKey: [...key, 'board', 'posts', { page, size: 20, categoryId }], queryFn: () => boardApi.posts(session!, page, 20, categoryId) })
  const base = `/groups/${session!.groupId}`
  function changePage(next: number) { const p = new URLSearchParams(params); p.set('page', String(next)); setParams(p) }
  return <section className="page board-page"><Link className="back-link" to={base}><ArrowLeft size={16} /> 대시보드</Link><div className="section-head"><div><div className="eyebrow">PARTY KNOWLEDGE</div><h1>공략 게시판</h1><p className="muted">{group.data?.name || session!.name} · 공략과 참고 자료를 함께 나눠요.</p></div><div className="actions wrap">{me.data!.role === 'OWNER' && <Link className="button" to={`${base}/categories`}><Settings2 size={16} /> 카테고리 관리</Link>}<Link className="button primary" to={`${base}/posts/new`}><Plus size={16} /> 게시글 작성</Link></div></div>
    <div className="card board-list"><label className="board-filter">게임 카테고리<select aria-label="게임 카테고리 필터" value={categoryId || ''} onChange={e => { const next = new URLSearchParams(); if (e.target.value) next.set('categoryId', e.target.value); setParams(next) }}><option value="">전체 게시글</option>{categories.data?.map(c => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}</select></label>
      {categories.error && <Feedback error={categories.error} retry={() => void categories.refetch()} />}
      {categories.data?.length === 0 && <p className="feedback">{me.data!.role === 'OWNER' ? <Link to={`${base}/categories`}>게시글을 작성하려면 먼저 카테고리를 만들어 주세요.</Link> : '그룹 관리자가 카테고리를 생성하면 게시글을 작성할 수 있어요.'}</p>}
      {posts.isPending ? <Loading /> : posts.error ? <Feedback error={posts.error} retry={() => void posts.refetch()} /> : <><div className="post-list-head"><span>제목</span><span>작성자</span><span>작성일</span></div>{posts.data.content.length ? <ul className="post-list">{posts.data.content.map(post => <li key={post.postId}><Link to={`${base}/posts/${post.postId}`}><span className="post-list-title"><span className="badge">{post.categoryName}</span><strong>{post.title}</strong></span><span className="post-author">{post.authorNickname}</span><time>{postDate(post.createdAt)}</time></Link></li>)}</ul> : <p className="board-empty">게시글이 없습니다.</p>}<div className="pagination"><button className="button small" disabled={page === 0} onClick={() => changePage(page - 1)}>이전 페이지</button><span>{page + 1} / {Math.max(posts.data.totalPages, 1)} · 총 {posts.data.totalElements}개</span><button className="button small" disabled={!posts.data.hasNext} onClick={() => changePage(page + 1)}>다음 페이지</button></div></>}
    </div></section>
}

export function PostDetail() {
  const { session, me, key } = useGroupSession()
  const id = Number(useParams().postId)
  const navigate = useNavigate(), client = useQueryClient()
  const post = useQuery({ queryKey: [...key, 'board', 'post', id], queryFn: () => boardApi.post(session!, id), enabled: Number.isSafeInteger(id) && id > 0 })
  const remove = useMutation({ mutationFn: () => boardApi.delete(session!, id), onSuccess: async () => { client.removeQueries({ queryKey: [...key, 'board', 'post', id] }); await refreshPosts(client, key); navigate(`/groups/${session!.groupId}/posts`, { replace: true }) } })
  if (!Number.isSafeInteger(id) || id < 1) return <div className="page"><p role="alert">잘못된 게시글 주소입니다.</p></div>
  if (post.isPending) return <Loading />
  if (post.error) return <div className="page"><Feedback error={post.error} retry={() => void post.refetch()} /></div>
  const data = post.data, own = data.authorId === me.data!.memberId, canDelete = own || me.data!.role === 'OWNER'
  return <article className="page board-page"><Link className="back-link" to={`/groups/${session!.groupId}/posts`}><ArrowLeft size={16} /> 게시글 목록</Link><div className="card post-detail"><span className="badge">{data.categoryName}</span><h1>{data.title}</h1><div className="post-meta"><span>{data.authorNickname}</span><span>작성 {postDate(data.createdAt)}</span>{data.updatedAt !== data.createdAt && <span>수정 {postDate(data.updatedAt)}</span>}</div><TextWithLinks content={data.content || ''} /><div className="post-actions">{own && <Link className="button" to={`/groups/${session!.groupId}/posts/${id}/edit`}>게시글 수정</Link>}{canDelete && <button className="button danger" disabled={remove.isPending} onClick={() => { if (window.confirm('이 게시글을 삭제할까요? 삭제한 내용은 복구할 수 없습니다.')) remove.mutate() }}>{remove.isPending ? '삭제 중…' : '게시글 삭제'}</button>}</div>{remove.error && <Feedback error={remove.error} />}</div></article>
}

export function PostEditor({ editing = false }: { editing?: boolean }) {
  const { session, me, key } = useGroupSession()
  const id = Number(useParams().postId)
  const categories = useQuery({ queryKey: [...key, 'board', 'categories'], queryFn: () => boardApi.categories(session!) })
  const post = useQuery({ queryKey: [...key, 'board', 'post', id], queryFn: () => boardApi.post(session!, id), enabled: editing && Number.isSafeInteger(id) && id > 0, refetchOnWindowFocus: false })
  if (editing && (!Number.isSafeInteger(id) || id < 1)) return <div className="page"><p role="alert">잘못된 게시글 주소입니다.</p></div>
  if (categories.isPending || (editing && post.isPending)) return <Loading />
  if (!categories.data || (categories.error && !isTemporaryError(categories.error)) || (editing && (!post.data || (post.error && !isTemporaryError(post.error))))) return <div className="page"><Feedback error={categories.error || post.error} retry={() => { void categories.refetch(); if (editing) void post.refetch() }} /></div>
  if (editing && post.data!.authorId !== me.data!.memberId) return <div className="page"><p role="alert">작성자만 게시글을 수정할 수 있습니다.</p></div>
  return <>{(categories.error || (editing && post.error)) && <Feedback error={categories.error || post.error} retry={() => { void categories.refetch(); if (editing) void post.refetch() }} />}<PostForm key={`${session!.revision}-${editing ? id : 'new'}`} initial={editing ? post.data : undefined} categories={categories.data} /></>
}
function PostForm({ initial, categories }: { initial?: PostDetails; categories: { categoryId: number; name: string }[] }) {
  const { session, me, key } = useGroupSession()
  const navigate = useNavigate(), client = useQueryClient()
  const [category, setCategory] = useState(String(initial?.categoryId || '')), [title, setTitle] = useState(initial?.title || ''), [content, setContent] = useState(initial?.content || '')
  const [validation, setValidation] = useState(''), [saved, setSaved] = useState(false)
  const [destination, setDestination] = useState<number | null>(null)
  const [original] = useState(() => JSON.stringify({ category, title, content }))
  const dirty = !saved && original !== JSON.stringify({ category, title, content })
  useUnsaved(dirty)
  const save = useMutation({ mutationFn: async () => {
    const body = { categoryId: Number(category), title: title.trim(), content: content.trim() }
    const result = initial ? await boardApi.update(session!, initial.postId, body) : await boardApi.create(session!, body)
    setSaved(true)
    // 저장 완료 상태가 렌더된 다음 이동해 미저장 경고가 다시 나오지 않도록 합니다.
    await refreshPosts(client, key)
    return result.postId
  }, onSuccess: id => setDestination(id) })
  useEffect(() => { if (saved && destination !== null) navigate(`/groups/${session!.groupId}/posts/${destination}`, { replace: true }) }, [saved, destination, navigate, session])
  const base = `/groups/${session!.groupId}`
  return <section className="page board-page"><Link className="back-link" to={initial ? `${base}/posts/${initial.postId}` : `${base}/posts`}><ArrowLeft size={16} /> {initial ? '게시글로 돌아가기' : '목록으로'}</Link><h1>{initial ? '게시글 수정' : '게시글 작성'}</h1><p className="muted">작성자: {me.data!.nickname}</p>
    {categories.length === 0 ? <div className="card board-empty"><p>{me.data!.role === 'OWNER' ? '카테고리를 먼저 만들어 주세요.' : '그룹 관리자가 카테고리를 생성해야 글을 작성할 수 있어요.'}</p>{me.data!.role === 'OWNER' && <Link className="button primary" to={`${base}/categories`}>카테고리 관리</Link>}</div> : <form className="card post-form" onSubmit={e => { e.preventDefault(); if (!category || !title.trim() || !content.trim() || title.trim().length > 200 || content.trim().length > 20000) { setValidation('카테고리와 제목·본문을 확인해 주세요. 제목은 200자, 본문은 20,000자까지 입력할 수 있어요.'); return } if (!save.isPending && !saved) { setValidation(''); save.mutate() } }}><label>카테고리<select required value={category} onChange={e => setCategory(e.target.value)} disabled={save.isPending}><option value="">카테고리를 선택하세요</option>{categories.map(c => <option key={c.categoryId} value={c.categoryId}>{c.name}</option>)}</select></label><label>제목<input required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} disabled={save.isPending} /></label><label>본문<textarea required maxLength={20000} rows={16} value={content} onChange={e => setContent(e.target.value)} disabled={save.isPending} placeholder="공략과 참고 링크를 작성해 주세요. HTML은 일반 텍스트로 표시됩니다." /></label><span className="small-text muted">{content.length.toLocaleString()} / 20,000자</span>{validation && <p role="alert" className="feedback error">{validation}</p>}{save.error && <Feedback error={save.error} />}<button className="button primary" disabled={save.isPending || saved}>{save.isPending ? '저장 중…' : '게시글 저장'}</button></form>}
  </section>
}
