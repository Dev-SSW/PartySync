import { normalizeInvite } from '../utils/invite'
describe('초대 코드 정규화', () => {
  it.each([
    ' Abc_12-xy ',
    'https://party.example/join/Abc_12-xy',
    'http://localhost:5173/join/Abc_12-xy',
    '/join/Abc_12-xy',
    'https://party.example/join/Abc_12-xy/',
  ])('%s에서 같은 코드 추출', (input) => expect(normalizeInvite(input)).toBe('Abc_12-xy'))
  it.each([
    '',
    'https://example.com/groups/123',
    '/join/',
    '/join/a/b',
    '//evil.example/join/code',
    'javascript:alert(1)',
    'ftp://example.com/join/code',
    'https://user:password@example.com/join/code',
    'https://example.com/join/code?token=secret',
    '/join/code#hash',
    '/join/%2Fbad',
    'https://example.com/a/../join/code',
    'a'.repeat(129),
    'not a code',
    'http://',
    '/join/%ZZ',
  ])('지원하지 않는 입력 거절: %s', (input) =>
    expect(() => normalizeInvite(input)).toThrow('초대 코드 또는'),
  )
})
