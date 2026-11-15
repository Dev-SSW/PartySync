import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '../App'
import { AuthProvider } from '../features/member/Auth'
import { writeSessions } from '../features/member/storage'
import { TextWithLinks } from '../features/board/TextWithLinks'

const category = { categoryId: 1, name: '로스트아크', description: '레이드 공략', createdAt: '2026-11-01T10:00:00' }
const post = { postId: 3, groupId: 1, categoryId: 1, categoryName: '로스트아크', authorId: 10, authorNickname: '작성자', title: '레이드 공략', content: '공략 본문\nhttps://example.com/guide', createdAt: '2026-11-01T10:00:00', updatedAt: '2026-11-01T10:00:00' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
function setup(path = '/groups/1/posts', options: { role?: 'OWNER' | 'MEMBER'; memberId?: number; failSave?: boolean; emptyCategories?: boolean; failLatest?: boolean } = {}) {
  let stored = { ...post }
  let categories = options.emptyCategories ? [] : [category]
  const fetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
    const groupId = (init.headers as Record<string, string>).Authorization?.includes('B'.repeat(43)) ? 2 : 1
    if (url.endsWith('/members/me')) return json({ memberId: options.memberId || 10, groupId, nickname: '현재 멤버', role: options.role || 'MEMBER' })
    if (url.includes('/categories')) {
      if (init.method === 'POST') { categories = [...categories, { ...category, categoryId: 2, ...JSON.parse(init.body as string) }]; return json(categories.at(-1), 201) }
      if (init.method === 'PUT') return json({ ...category, ...JSON.parse(init.body as string) })
      if (init.method === 'DELETE') return json({ code: 'CATEGORY_IN_USE' }, 409)
      return json(categories)
    }
    if (url.includes('/posts')) {
      if (init.method === 'POST' || init.method === 'PUT') {
        if (options.failSave) return json({}, 500)
        stored = { ...stored, ...JSON.parse(init.body as string) }
        return json(init.method === 'POST' ? { postId: 3 } : stored, init.method === 'POST' ? 201 : 200)
      }
      if (init.method === 'DELETE') return new Response(null, { status: 204 })
      if (url.includes('?')) {
        if (options.failLatest) return json({}, 503)
        const page = Number(new URL(url, 'https://test.invalid').searchParams.get('page') || 0)
        return json({ content: [{ ...stored, title: groupId === 2 ? '두번째 그룹 글' : page ? '다음 페이지 글' : stored.title }], page, size: 20, totalElements: 21, totalPages: 2, hasNext: page === 0 })
      }
      return json(stored)
    }
    if (url.endsWith('/members')) return json([{ memberId: 10, nickname: '현재 멤버', role: options.role || 'MEMBER', joinedAt: '' }])
    if (url.includes('common-availability')) return json({ groupId, days: [] })
    if (url.includes('/availability?')) return json({ groupId, days: [] })
    return json({ groupId, name: '테스트 파티', description: '', memberCount: 1, createdAt: '' })
  })
  vi.stubGlobal('fetch', fetch)
  writeSessions([{ groupId: 1, name: '테스트 파티', token: 'A'.repeat(43), revision: 'one' }, { groupId: 2, name: '다른 파티', token: 'B'.repeat(43), revision: 'two' }])
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<QueryClientProvider client={client}><AuthProvider><RouterProvider router={router} /></AuthProvider></QueryClientProvider>)
  return { fetch, router, client }
}
describe('게시판 화면과 API', () => {
  it('목록·카테고리 필터·페이지네이션을 API 쿼리에 반영한다', async () => {
    const { fetch } = setup()
    await screen.findByRole('link', { name: /레이드 공략/ })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '게임 카테고리 필터' }), '1')
    await waitFor(() => expect(fetch.mock.calls.some(c => c[0].includes('categoryId=1'))).toBe(true))
    await userEvent.click(screen.getByRole('button', { name: '다음 페이지' }))
    await screen.findByText('다음 페이지 글')
    expect(fetch.mock.calls.some(c => c[0].includes('page=1') && c[0].includes('categoryId=1'))).toBe(true)
  })
  it('작성 성공 시 작성자 ID 없이 저장하고 상세로 이동한다', async () => {
    const { fetch, router } = setup('/groups/1/posts/new')
    await screen.findByRole('heading', { name: '게시글 작성' })
    await userEvent.selectOptions(screen.getByLabelText('카테고리'), '1')
    await userEvent.type(screen.getByLabelText('제목'), '새 공략')
    await userEvent.type(screen.getByLabelText('본문'), '새 본문')
    await userEvent.click(screen.getByRole('button', { name: '게시글 저장' }))
    await screen.findByRole('heading', { name: '새 공략' })
    expect(router.state.location.pathname).toBe('/groups/1/posts/3')
    const sent = fetch.mock.calls.find(c => c[1].method === 'POST')!
    expect(JSON.parse(sent[1].body)).toEqual({ categoryId: 1, title: '새 공략', content: '새 본문' })
  })
  it('공백 제목·본문은 API 호출 전에 거절한다', async () => {
    const { fetch } = setup('/groups/1/posts/new')
    await screen.findByLabelText('제목')
    await userEvent.selectOptions(screen.getByLabelText('카테고리'), '1')
    await userEvent.type(screen.getByLabelText('제목'), '   '); await userEvent.type(screen.getByLabelText('본문'), '   ')
    await userEvent.click(screen.getByRole('button', { name: '게시글 저장' }))
    expect(screen.getByRole('alert')).toHaveTextContent('카테고리와 제목')
    expect(fetch.mock.calls.some(c => c[1].method === 'POST')).toBe(false)
  })
  it('저장 오류 시 입력을 보존하고 페이지 이탈을 확인한다', async () => {
    const { fetch, router } = setup('/groups/1/posts/new', { failSave: true })
    await screen.findByLabelText('제목'); await userEvent.selectOptions(screen.getByLabelText('카테고리'), '1')
    await userEvent.type(screen.getByLabelText('제목'), '보존할 제목'); await userEvent.type(screen.getByLabelText('본문'), '보존할 본문')
    await userEvent.click(screen.getByRole('button', { name: '게시글 저장' })); await screen.findByRole('alert')
    expect(screen.getByLabelText('본문')).toHaveValue('보존할 본문')
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await userEvent.click(screen.getByRole('link', { name: /목록으로/ }))
    expect(router.state.location.pathname).toBe('/groups/1/posts/new')
    expect(fetch.mock.calls.filter(c => c[1].method === 'POST')).toHaveLength(1)
  })
  it('작성자는 수정할 수 있고 수정 결과를 상세에 반영한다', async () => {
    const { fetch } = setup('/groups/1/posts/3/edit')
    const title = await screen.findByLabelText('제목'); await userEvent.clear(title); await userEvent.type(title, '수정된 공략')
    await userEvent.click(screen.getByRole('button', { name: '게시글 저장' }))
    await screen.findByRole('heading', { name: '수정된 공략' })
    expect(fetch.mock.calls.some(c => c[1].method === 'PUT')).toBe(true)
  })
  it.each([{ role: 'MEMBER' as const, memberId: 10, edit: true, remove: true }, { role: 'OWNER' as const, memberId: 20, edit: false, remove: true }, { role: 'MEMBER' as const, memberId: 20, edit: false, remove: false }])('상세 권한 $role / $memberId', async options => {
    setup('/groups/1/posts/3', options); await screen.findByRole('heading', { name: '레이드 공략' })
    expect(!!screen.queryByRole('link', { name: '게시글 수정' })).toBe(options.edit)
    expect(!!screen.queryByRole('button', { name: '게시글 삭제' })).toBe(options.remove)
  })
  it('OWNER도 타인의 수정 화면 접근은 거절한다', async () => {
    setup('/groups/1/posts/3/edit', { role: 'OWNER', memberId: 20 })
    await screen.findByText('작성자만 게시글을 수정할 수 있습니다.')
    expect(screen.queryByLabelText('본문')).toBeNull()
  })
  it('삭제 확인을 거쳐 목록으로 이동한다', async () => {
    const { fetch, router } = setup('/groups/1/posts/3')
    await screen.findByRole('heading', { name: '레이드 공략' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await userEvent.click(screen.getByRole('button', { name: '게시글 삭제' })); expect(fetch.mock.calls.some(c => c[1].method === 'DELETE')).toBe(false)
    confirm.mockReturnValue(true); await userEvent.click(screen.getByRole('button', { name: '게시글 삭제' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/groups/1/posts'))
  })
  it('그룹 전환 시 이전 그룹 글을 재사용하지 않고 해당 그룹 토큰을 전송한다', async () => {
    const { fetch, router } = setup()
    await screen.findByText('레이드 공략')
    await act(async () => { await router.navigate('/groups/2/posts') })
    await screen.findByText('두번째 그룹 글')
    expect(screen.queryByText('레이드 공략')).toBeNull()
    const call = fetch.mock.calls.find(c => c[0].startsWith('/api/groups/2/posts?'))!
    expect(call[1].headers.Authorization).toBe('Bearer ' + 'B'.repeat(43))
  })
  it('카테고리가 없으면 MEMBER에게 관리자 안내를 제공한다', async () => {
    setup('/groups/1/posts/new', { emptyCategories: true })
    await screen.findByText('그룹 관리자가 카테고리를 생성해야 글을 작성할 수 있어요.')
    expect(screen.queryByRole('button', { name: '게시글 저장' })).toBeNull()
  })
})
describe('카테고리 관리와 최신 글 패널', () => {
  it('MEMBER의 관리 화면을 차단한다', async () => {
    const { fetch } = setup('/groups/1/categories')
    await screen.findByText('파티장만 카테고리를 관리할 수 있습니다.')
    expect(fetch.mock.calls.some(c => c[0].endsWith('/categories'))).toBe(false)
  })
  it('OWNER가 카테고리를 생성·수정하며 사용 중 삭제 오류를 안내한다', async () => {
    const { fetch } = setup('/groups/1/categories', { role: 'OWNER' })
    await screen.findByLabelText('카테고리 이름')
    await userEvent.type(screen.getByLabelText('카테고리 이름'), '메이플스토리')
    await userEvent.click(screen.getByRole('button', { name: '카테고리 저장' })); await screen.findByText('메이플스토리')
    await userEvent.click(screen.getByRole('button', { name: '로스트아크 수정' }))
    await userEvent.clear(screen.getByLabelText('카테고리 이름')); await userEvent.type(screen.getByLabelText('카테고리 이름'), '수정 이름')
    await userEvent.click(screen.getByRole('button', { name: '카테고리 저장' }))
    await waitFor(() => expect(fetch.mock.calls.some(c => c[1].method === 'PUT')).toBe(true))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: '로스트아크 삭제' }))
    await screen.findByText(/게시글을 먼저 정리해 주세요/)
  })
  it('최신 글은 5개만 요청하고 조회 실패에도 시간표를 유지한다', async () => {
    const { fetch } = setup('/groups/1', { failLatest: true })
    await screen.findByRole('region', { name: '주간 가능 시간표' })
    const panel = screen.getByRole('heading', { name: '최신 게시글' }).closest('section')!
    await within(panel).findByRole('alert')
    expect(screen.getByRole('region', { name: '주간 가능 시간표' })).toBeInTheDocument()
    expect(fetch.mock.calls.some(c => c[0].includes('size=5'))).toBe(true)
  })
  it('대시보드 최신 글에서 상세로 이동한다', async () => {
    setup('/groups/1')
    await userEvent.click(await screen.findByRole('link', { name: /레이드 공략/ }))
    await screen.findByRole('heading', { name: '레이드 공략' })
  })
})
describe('일반 텍스트와 안전한 링크', () => {
  it('HTML과 위험한 프로토콜을 실행하지 않고 HTTP(S)만 새 탭 링크로 만든다', () => {
    const text = '<img src=x onerror=alert(1)>\njavascript:alert(1) data:text/html,test\nhttps://example.com/guide\nhttp://example.com/info'
    const { container } = render(<TextWithLinks content={text} />)
    expect(container.querySelector('img')).toBeNull(); expect(container.textContent).toContain('<img')
    const links = screen.getAllByRole('link'); expect(links).toHaveLength(2)
    for (const link of links) { expect(link).toHaveAttribute('target', '_blank'); expect(link).toHaveAttribute('rel', 'noopener noreferrer'); expect(link.getAttribute('href')).toMatch(/^https?:\/\//) }
    expect(container.textContent).toContain('\njavascript:')
  })
})
