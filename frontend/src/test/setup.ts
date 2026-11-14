import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'
// 800ms 자동 저장과 이어지는 비동기 조회가 끝날 여유를 둡니다.
configure({ asyncUtilTimeout: 2500 })
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
