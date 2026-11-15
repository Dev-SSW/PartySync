import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, FileText } from 'lucide-react'
import { boardApi } from '../../api/board'
import { useGroupSession } from '../member/Auth'
import { Feedback, Loading } from '../../components/Feedback'
import { postDate } from './queries'

/** 조회 오류를 패널 안에서 처리해 캘린더 편집과 분리합니다. */
export function LatestPosts() {
  const { session, key } = useGroupSession()
  const posts = useQuery({ queryKey: [...key, 'board', 'posts', { page: 0, size: 5 }], queryFn: () => boardApi.posts(session!, 0, 5) })
  return <section className="card latest-posts"><div className="section-head"><h2><FileText size={17} /> 최신 게시글</h2><Link className="board-text-link" to={`/groups/${session!.groupId}/posts`}>전체 보기 <ArrowRight size={14} /></Link></div>
    {posts.isPending ? <Loading /> : posts.error ? <Feedback error={posts.error} retry={() => void posts.refetch()} /> : posts.data.content.length ? <ul className="latest-post-list">{posts.data.content.map(post => <li key={post.postId}><Link to={`/groups/${session!.groupId}/posts/${post.postId}`}><span className="badge">{post.categoryName}</span><strong>{post.title}</strong><span className="muted small-text">{post.authorNickname} · {postDate(post.createdAt)}</span></Link></li>)}</ul> : <div className="board-empty"><p>아직 게시글이 없어요.</p><Link className="board-text-link" to={`/groups/${session!.groupId}/posts/new`}>첫 공략 작성하기</Link></div>}
  </section>
}
