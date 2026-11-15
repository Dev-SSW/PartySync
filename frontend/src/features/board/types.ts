export interface Category { categoryId: number; name: string; description: string | null; createdAt: string }
export interface PostSummary {
  postId: number; title: string; categoryId: number; categoryName: string
  authorId: number; authorNickname: string; createdAt: string; updatedAt: string
}
export interface PostDetails extends PostSummary { groupId: number; content: string }
export interface PostPage { content: PostSummary[]; page: number; size: number; totalElements: number; totalPages: number; hasNext: boolean }
export interface PostInput { categoryId: number; title: string; content: string }
export interface CategoryInput { name: string; description: string }
