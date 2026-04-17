<script setup lang="ts">
definePageMeta({ middleware: 'admin' })
const { $trpc } = useNuxtApp()

const { data: profiles, refresh } = await useAsyncData('profiles', () => $trpc.analytics.getProfiles.query())
const { data: sessions, refresh: refreshSessions } = await useAsyncData('sessions', () => $trpc.analytics.getActiveSessions.query())

async function adjustScore(userId: string, genre: string, currentScore: number) {
  const newScore = prompt(`Nouveau score pour ${genre}:`, String(currentScore))
  if (newScore !== null) {
    await $trpc.analytics.updateProfileScore.mutate({ userId, genre, score: parseInt(newScore) })
    refresh()
  }
}

async function kill(sessionId: string) {
  await $trpc.analytics.killSession.mutate({ sessionId })
  refreshSessions()
}
</script>

<template>
  <div class="p-8">
    <div class="flex gap-4 mb-8">
      <NuxtLink to="/admin/analytics" class="px-4 py-2 bg-primary rounded">Analytiques Profils</NuxtLink>
      <NuxtLink to="/admin/sessions" class="px-4 py-2 bg-surface rounded">Sessions Actives</NuxtLink>
    </div>

    <h1 class="text-2xl font-bold mb-6">Sessions Actives</h1>
    <div class="bg-surface p-4 rounded-lg">
      <div v-for="s in sessions" :key="s.sessionId" class="flex justify-between p-2 border-b border-border">
        <span>{{ s.email }} - Page: {{ s.currentPage }}</span>
        <button @click="kill(s.sessionId)" class="text-red-500">Déconnecter</button>
      </div>
    </div>

    <h1 class="text-2xl font-bold mt-8 mb-6">Analyse Comportementale</h1>
    <div v-for="p in profiles" :key="p.userId" class="bg-surface p-4 rounded-lg mb-4 border border-border">
      <h2 class="font-bold">{{ p.email }}</h2>
      <div class="grid grid-cols-2 gap-4 mt-2">
        <div v-for="(score, genre) in p.scores" :key="genre" class="flex items-center justify-between bg-surface-secondary p-2 rounded">
          <span>{{ genre }}</span>
          <button @click="adjustScore(p.userId, genre, score)" class="bg-primary px-2 py-1 rounded text-sm">
            {{ score }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
