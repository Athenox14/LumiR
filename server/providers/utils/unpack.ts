export const safeUnpack = (packedSource: string): string => {
  try {
    const argsRegex = /}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\./
    const match = argsRegex.exec(packedSource)

    if (!match) throw new Error('Invalid Packer format or unable to parse safely.')

    let [_, p, aStr, cStr, kStr] = match
    const a = parseInt(aStr)
    const c = parseInt(cStr)
    let k = kStr.split('|')

    const base62 = (n: number): string => {
      const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
      return n < a ? chars[n] : base62(Math.floor(n / a)) + chars[n % a]
    }

    const dict: Record<string, string> = {}
    for (let i = 0; i < c; i++) {
      const key = base62(i)
      const word = k[i] || key
      dict[key] = word
    }

    return p.replace(/\b\w+\b/g, word => {
      return dict[word] || word
    })
  } catch (err) {
    throw new Error(`Failed to unpack script: ${err}`)
  }
}
