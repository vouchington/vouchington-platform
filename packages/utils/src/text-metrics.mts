export function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length
}
export function countSentences(value: string): number {
  return value.split(/[.!?]+["')}\]]*(?:\s|$)/).filter((sentence) => sentence.trim()).length
}
