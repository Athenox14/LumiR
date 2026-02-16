export const compareTwoStrings = (first: string, second: string): number => {
  first = first.replace(/\s+/g, '')
  second = second.replace(/\s+/g, '')

  if (first === second) return 1
  if (first.length < 2 || second.length < 2) return 0

  const firstBigrams = new Map()
  for (let i = 0; i < first.length - 1; i++) {
    const bigram = first.substring(i, i + 2)
    const count = firstBigrams.has(bigram) ? firstBigrams.get(bigram) + 1 : 1
    firstBigrams.set(bigram, count)
  }

  let intersectionSize = 0
  for (let i = 0; i < second.length - 1; i++) {
    const bigram = second.substring(i, i + 2)
    const count = firstBigrams.has(bigram) ? firstBigrams.get(bigram) : 0
    if (count > 0) {
      firstBigrams.set(bigram, count - 1)
      intersectionSize++
    }
  }

  return (2.0 * intersectionSize) / (first.length + second.length - 2)
}

export const substringAfter = (str: string, toFind: string) => {
  const index = str.indexOf(toFind)
  return index == -1 ? '' : str.substring(index + toFind.length)
}

export const substringBefore = (str: string, toFind: string) => {
  const index = str.indexOf(toFind)
  return index == -1 ? '' : str.substring(0, index)
}

export const substringAfterLast = (str: string, toFind: string) => {
  const index = str.lastIndexOf(toFind)
  return index == -1 ? '' : str.substring(index + toFind.length)
}

export const substringBeforeLast = (str: string, toFind: string) => {
  const index = str.lastIndexOf(toFind)
  return index == -1 ? '' : str.substring(0, index)
}

function romanToArabic(roman: string): number {
  const romanMap: Record<string, number> = {
    i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000,
  }
  roman = roman.toLowerCase()
  let result = 0
  for (let i = 0; i < roman.length; i++) {
    const current = romanMap[roman[i]!]!
    const next = romanMap[roman[i + 1]!]
    if (next && current < next) {
      result += next - current
      i++
    } else {
      result += current
    }
  }
  return result
}

export function removeSpecialChars(title: string | undefined | null): string {
  if (!title) return ''
  return title
    .replace(/[^A-Za-z0-9!@#$%^&*()\-= ]/gim, ' ')
    .replace(/[^A-Za-z0-9\-= ]/gim, '')
    .replace(/ {2}/g, ' ')
}

export function transformSpecificVariations(title: string | undefined | null): string {
  if (!title) return ''
  return title.replace(/yuu/g, 'yu').replace(/ ou/g, ' oh')
}

export function cleanTitle(title: string | undefined | null): string {
  if (!title) return ''
  return transformSpecificVariations(
    removeSpecialChars(
      title
        .replace(/[^A-Za-z0-9!@#$%^&*() ]/gim, ' ')
        .replace(/(th|rd|nd|st) (Season|season)/gim, '')
        .replace(/\([^(]*\)$/gim, '')
        .replace(/season/g, '')
        .replace(/\b(IX|IV|V?I{0,3})\b/gi, (match: any) => romanToArabic(match).toString())
        .replace(/ {2}/g, ' ')
        .replace(/"/g, '')
        .trimEnd()
    )
  )
}

export function findSimilarTitles(inputTitle: string, titles: any[]): any[] {
  const results: (any & { similarity: number })[] = []

  titles?.forEach((titleObj: any) => {
    const title = cleanTitle(
      titleObj?.title
        ?.toLowerCase()
        ?.replace(/\([^)]*\)/g, '')
        .trim() || ''
    )
    const similarity = compareTwoStrings(cleanTitle(inputTitle?.toLowerCase() || ''), title)
    if (similarity > 0.6) {
      results.push({ ...titleObj, similarity })
    }
  })

  return results.sort((a, b) => b.similarity - a.similarity)
}

export const isJson = (str: string) => {
  try {
    JSON.parse(str)
  } catch {
    return false
  }
  return true
}
