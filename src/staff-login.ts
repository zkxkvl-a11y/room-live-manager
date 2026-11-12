// Staff IDs are mapped to Firebase email/password accounts. This is a UI alias,
// not a separate authentication provider. Keep the domain stable for existing users.
export const STAFF_EMAIL_DOMAIN = 'roomlive.invalid'
export function staffEmailFromId(input: string): string {
  const id = input.trim().toLowerCase()
  if (!/^[a-z][a-z0-9_-]{2,23}$/.test(id)) {
    throw new Error('아이디는 영문으로 시작하는 3~24자의 영문 소문자, 숫자, _ 또는 -만 사용할 수 있습니다.')
  }
  return id + '@' + STAFF_EMAIL_DOMAIN
}
export function loginEmailFromInput(input: string): string {
  const value = input.trim()
  if (value.includes('@')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new Error('이메일 주소 형식을 확인해 주세요.')
    }
    return value
  }
  return staffEmailFromId(value)
}
