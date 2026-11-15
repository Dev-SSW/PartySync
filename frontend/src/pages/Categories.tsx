import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { boardApi } from '../api/board'
import { useGroupSession } from '../features/member/Auth'
import { Feedback, Loading } from '../components/Feedback'
import type { Category } from '../features/board/types'

export function Categories() {
  const { session, me, key } = useGroupSession()
  const client = useQueryClient(), owner = me.data!.role === 'OWNER'
  const categories = useQuery({ queryKey: [...key, 'board', 'categories'], queryFn: () => boardApi.categories(session!), enabled: owner })
  const [selected, setSelected] = useState<number | null>(null), [name, setName] = useState(''), [description, setDescription] = useState(''), [validation, setValidation] = useState(''), [success, setSuccess] = useState('')
  const mutation = useMutation({ mutationFn: async (action: { kind: 'save' } | { kind: 'delete'; id: number }) => {
    if (action.kind === 'delete') await boardApi.deleteCategory(session!, action.id)
    else if (selected) await boardApi.updateCategory(session!, selected, { name: name.trim(), description: description.trim() })
    else await boardApi.createCategory(session!, { name: name.trim(), description: description.trim() })
    return action
  }, onSuccess: async action => { if (action.kind === 'save' || selected === action.id) { setSelected(null); setName(''); setDescription('') } setSuccess(action.kind === 'delete' ? '카테고리를 삭제했어요.' : '카테고리를 저장했어요.'); await client.invalidateQueries({ queryKey: [...key, 'board'] }) } })
  function edit(category: Category) { setSelected(category.categoryId); setName(category.name); setDescription(category.description || ''); setValidation(''); setSuccess(''); mutation.reset() }
  if (!owner) return <section className="page board-page"><h1>카테고리 관리</h1><p role="alert">파티장만 카테고리를 관리할 수 있습니다.</p><Link className="button" to={`/groups/${session!.groupId}/posts`}>게시판으로</Link></section>
  return <section className="page board-page"><Link className="back-link" to={`/groups/${session!.groupId}/posts`}><ArrowLeft size={16} /> 게시판</Link><h1>게임 카테고리 관리</h1><p className="muted">게시글이 있는 카테고리는 글을 먼저 정리한 후 삭제할 수 있어요.</p><div className="category-layout"><form className="card post-form" onSubmit={e => { e.preventDefault(); if (!name.trim() || name.trim().length > 100 || description.length > 2000) { setValidation('이름은 1~100자, 설명은 2,000자 이내로 입력해 주세요.'); return } if (!mutation.isPending) { setValidation(''); mutation.mutate({ kind: 'save' }) } }}><h2>{selected ? '카테고리 수정' : '카테고리 추가'}</h2><label>카테고리 이름<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} disabled={mutation.isPending} /></label><label>설명 (선택)<textarea rows={4} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} disabled={mutation.isPending} /></label>{validation && <p role="alert" className="feedback error">{validation}</p>}{mutation.error && <Feedback error={mutation.error} />}{success && <p role="status" className="feedback success">{success}</p>}<div className="actions"><button className="button primary" disabled={mutation.isPending}>{mutation.isPending ? '처리 중…' : '카테고리 저장'}</button>{selected && <button type="button" className="button" disabled={mutation.isPending} onClick={() => { setSelected(null); setName(''); setDescription(''); mutation.reset() }}>수정 취소</button>}</div></form><div className="card category-list">{categories.isPending ? <Loading /> : categories.error ? <Feedback error={categories.error} retry={() => void categories.refetch()} /> : categories.data.length === 0 ? <p className="board-empty">아직 카테고리가 없습니다.</p> : categories.data.map(category => <article key={category.categoryId}><h2>{category.name}</h2><p className="muted">{category.description || '설명 없음'}</p><div className="actions"><button className="button small" disabled={mutation.isPending} onClick={() => edit(category)} aria-label={`${category.name} 수정`}>수정</button><button className="button small danger" disabled={mutation.isPending} onClick={() => { if (window.confirm(`‘${category.name}’ 카테고리를 삭제할까요?`)) { setSuccess(''); mutation.mutate({ kind: 'delete', id: category.categoryId }) } }} aria-label={`${category.name} 삭제`}>삭제</button></div></article>)}</div></div></section>
}
