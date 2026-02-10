/**
 * Debug script pour tester les providers un par un.
 * Usage: npx tsx server/providers/test-debug.ts
 */
import axios from 'axios'
import { FrenchStream, EmpireStreaming, MesFilms, FlixHQ, HiMovies, Goku, SFlix } from './movies'

const QUERY = 'Zootopia 2'
const QUERY_FR = 'Zootopie 2'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

async function testRawFetch() {
  console.log('=== RAW FETCH TESTS ===\n')

  // Test fstream.net domain resolver
  try {
    console.log(`[RAW] GET https://fstream.net (domain resolver) ...`)
    const res = await axios.get('https://fstream.net', {
      headers: { 'User-Agent': UA },
      timeout: 10000,
      validateStatus: () => true,
    })
    console.log(`  → Status: ${res.status}`)
    const body = typeof res.data === 'string' ? res.data : ''
    const { load: loadHtml } = await import('cheerio')
    const $ = loadHtml(body)
    const mainUrl = $('a#mainUrl').attr('href')
    const accessBtn = $('a#accessBtn').attr('href')
    console.log(`  → mainUrl href: ${mainUrl}`)
    console.log(`  → accessBtn href: ${accessBtn}`)
  } catch (e: any) {
    console.log(`  → ERROR: ${e.message}`)
  }
  console.log()

  // Test FrenchStream domains
  const domains = [
    'https://french-stream.pink',
    'https://fs9.lol',
  ]

  for (const domain of domains) {
    try {
      console.log(`[RAW] GET ${domain} ...`)
      const res = await axios.get(domain, {
        headers: { 'User-Agent': UA },
        timeout: 10000,
        maxRedirects: 5,
        validateStatus: () => true,
      })
      console.log(`  → Status: ${res.status}`)
      console.log(`  → Content-Type: ${res.headers['content-type'] || 'N/A'}`)
      const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
      console.log(`  → Body snippet: ${body.substring(0, 200)}`)
      if (body.includes('cf-browser-verification') || body.includes('challenge-platform') || body.includes('Just a moment')) {
        console.log('  → CLOUDFLARE CHALLENGE DETECTED')
      }
    } catch (e: any) {
      console.log(`  → ERROR: ${e.message}`)
    }
    console.log()
  }
}

async function testProviders() {
  console.log('\n=== PROVIDER TESTS ===\n')

  const providers = [
    { name: 'FrenchStream', instance: new FrenchStream(), query: QUERY_FR },
    { name: 'EmpireStreaming', instance: new EmpireStreaming(), query: QUERY_FR },
    { name: 'MesFilms', instance: new MesFilms(), query: QUERY_FR },
    { name: 'FlixHQ', instance: new FlixHQ(), query: QUERY },
    { name: 'HiMovies', instance: new HiMovies(), query: QUERY },
    { name: 'Goku', instance: new Goku(), query: QUERY },
    { name: 'SFlix', instance: new SFlix(), query: QUERY },
  ]

  for (const { name, instance, query } of providers) {
    console.log(`--- ${name} ---`)
    try {
      // Step 1: Search
      console.log(`  [search] "${query}" ...`)
      const t0 = Date.now()
      const searchResults = await instance.search(query)
      const elapsed = Date.now() - t0
      console.log(`  [search] ${searchResults.results.length} results (${elapsed}ms)`)

      if (searchResults.results.length === 0) {
        console.log(`  [search] No results\n`)
        continue
      }

      const match = searchResults.results[0]
      console.log(`  [search] Best: "${match.title}" (id=${match.id}) type=${match.type}`)

      // Step 2: Media info
      console.log(`  [info] ...`)
      const t1 = Date.now()
      const info = await instance.fetchMediaInfo(match.id)
      console.log(`  [info] ${info.episodes?.length || 0} episodes (${Date.now() - t1}ms)`)

      if (!info.episodes?.length) {
        console.log(`  [info] No episodes\n`)
        continue
      }

      const episode = info.episodes[0]
      console.log(`  [info] Episode 0: id=${episode.id?.substring(0, 80)}`)

      // Step 3: Servers
      console.log(`  [servers] ...`)
      const t2 = Date.now()
      const servers = await instance.fetchEpisodeServers(episode.id, match.id)
      console.log(`  [servers] ${servers.length} servers (${Date.now() - t2}ms)`)

      for (const srv of servers) {
        console.log(`    - ${srv.name}: ${srv.url?.substring(0, 80)}`)
      }

      // Step 4: Sources (first server only)
      if (servers.length > 0) {
        console.log(`  [sources] trying server "${servers[0].name}" ...`)
        const t3 = Date.now()
        try {
          const sources = await instance.fetchEpisodeSources(episode.id, match.id, servers[0].name as any)
          console.log(`  [sources] ${sources.sources.length} sources, ${sources.subtitles?.length || 0} subs (${Date.now() - t3}ms)`)
          for (const src of sources.sources) {
            console.log(`    - ${src.quality || 'auto'} ${src.isM3U8 ? 'HLS' : 'MP4'}: ${src.url?.substring(0, 80)}`)
          }
        } catch (e: any) {
          console.log(`  [sources] ERROR: ${e.message}`)
        }
      }
    } catch (e: any) {
      console.log(`  ERROR: ${e.message}`)
    }
    console.log()
  }
}

async function main() {
  await testRawFetch()
  await testProviders()
  console.log('\n=== DONE ===')
}

main().catch(console.error)
