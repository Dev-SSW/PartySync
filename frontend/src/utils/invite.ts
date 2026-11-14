/** 코드 또는 /join/{code} 링크를 API에 보낼 코드로 정규화합니다. */
export function normalizeInvite(input: string): string {
  const value = input.trim()
  const invalid = () =>
    new Error('초대 코드 또는 /join/코드 형식의 올바른 초대 링크를 입력해 주세요.')
  if (!value || value.length > 2048) throw invalid()
  if (/^[A-Za-z0-9_-]{1,128}$/.test(value)) return value
  let url: URL
  try {
    if (!value.startsWith('/join/') && !/^https?:\/\//i.test(value)) throw invalid()
    url = new URL(value, 'https://partysync.invalid')
  } catch {
    throw invalid()
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    value.startsWith('//') ||
    value.includes('\\')
  )
    throw invalid()
  // 정규화 과정에서 ../ 같은 비정상 경로가 초대 경로로 바뀌지 않도록 원본도 검사합니다.
  const rawPath = value.startsWith('/') ? value : value.replace(/^https?:\/\/[^/]+/i, '')
  if (!/^\/join\/[^/]+\/?$/.test(rawPath)) throw invalid()
  const match = url.pathname.match(/^\/join\/([^/]+)\/?$/)
  if (!match) throw invalid()
  let code: string
  try {
    code = decodeURIComponent(match[1])
  } catch {
    throw invalid()
  }
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(code)) throw invalid()
  return code
}
