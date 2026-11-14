import { createBrowserRouter, Link, RouterProvider, type RouteObject } from 'react-router-dom'
import { Layout } from './layouts/Layout'
import { Home } from './pages/Home'
import { GroupForm } from './pages/GroupForms'
import { RequireMember } from './features/member/Auth'
import { Dashboard } from './pages/Dashboard'
import { Weekly } from './pages/Weekly'

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    errorElement: (
      <div className="page narrow">
        <h1>화면을 불러오지 못했어요</h1>
        <p>새로고침 후 다시 시도해 주세요.</p>
        <a className="button" href="/">
          처음으로
        </a>
      </div>
    ),
    children: [
      { path: '/', element: <Home /> },
      { path: '/groups/new', element: <GroupForm key="create" mode="create" /> },
      { path: '/join', element: <GroupForm key="join" mode="join" /> },
      { path: '/join/:inviteCode', element: <GroupForm mode="join" /> },
      {
        element: <RequireMember />,
        children: [
          { path: '/groups/:groupId', element: <Dashboard /> },
          { path: '/groups/:groupId/schedule/weekly', element: <Weekly /> },
        ],
      },
      {
        path: '*',
        element: (
          <section className="page narrow">
            <h1>페이지를 찾을 수 없어요</h1>
            <p className="muted">초대 링크나 주소를 확인해 주세요.</p>
            <Link className="button primary" to="/">
              처음으로
            </Link>
          </section>
        ),
      },
    ],
  },
]
export default function App() {
  return <RouterProvider router={createBrowserRouter(routes)} />
}
