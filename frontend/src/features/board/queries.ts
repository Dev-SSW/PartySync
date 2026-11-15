import type { QueryClient } from '@tanstack/react-query'

export function refreshPosts(client: QueryClient, groupKey: readonly unknown[]) {
  return Promise.all([
    client.invalidateQueries({ queryKey: [...groupKey, 'board', 'posts'] }),
    client.invalidateQueries({ queryKey: [...groupKey, 'board', 'post'] }),
  ])
}
// 서버의 LocalDateTime은 KST이며 브라우저 타임존으로 재해석하지 않습니다.
export const postDate = (value: string) => value ? value.replace('T', ' ').slice(0, 16) : ''
