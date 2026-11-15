import { request, type Credentials } from './client'
import type { Category, CategoryInput, PostDetails, PostInput, PostPage } from '../features/board/types'

const base = (auth: Credentials) => `/groups/${auth.groupId}`
export const boardApi = {
  categories: (auth: Credentials) => request<Category[]>(`${base(auth)}/categories`, { auth }),
  createCategory: (auth: Credentials, body: CategoryInput) => request<Category>(`${base(auth)}/categories`, { auth, method: 'POST', body }),
  updateCategory: (auth: Credentials, id: number, body: CategoryInput) => request<Category>(`${base(auth)}/categories/${id}`, { auth, method: 'PUT', body }),
  deleteCategory: (auth: Credentials, id: number) => request<void>(`${base(auth)}/categories/${id}`, { auth, method: 'DELETE' }),
  posts: (auth: Credentials, page = 0, size = 20, categoryId?: number) => {
    const query = new URLSearchParams({ page: String(page), size: String(size) })
    if (categoryId) query.set('categoryId', String(categoryId))
    return request<PostPage>(`${base(auth)}/posts?${query}`, { auth })
  },
  post: (auth: Credentials, id: number) => request<PostDetails>(`${base(auth)}/posts/${id}`, { auth }),
  create: (auth: Credentials, body: PostInput) => request<{ postId: number }>(`${base(auth)}/posts`, { auth, method: 'POST', body }),
  update: (auth: Credentials, id: number, body: PostInput) => request<PostDetails>(`${base(auth)}/posts/${id}`, { auth, method: 'PUT', body }),
  delete: (auth: Credentials, id: number) => request<void>(`${base(auth)}/posts/${id}`, { auth, method: 'DELETE' }),
}
