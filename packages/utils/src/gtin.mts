const FORMAT = /^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/
export function isValidGtinFormat(value: string): boolean {
  return FORMAT.test(value)
}
export function isValidGtinCheckDigit(value: string): boolean {
  if (!isValidGtinFormat(value)) return false
  const digits = value.padStart(14, '0').split('').map(Number)
  const total = digits
    .slice(0, 13)
    .reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 3 : 1), 0)
  return (10 - (total % 10)) % 10 === digits[13]
}
