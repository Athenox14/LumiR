<script setup lang="ts">
definePageMeta({ middleware: 'admin' })
const { $trpc } = useNuxtApp()

const { data: profiles, refresh } = await useAsyncData('profiles', () => $trpc.analytics.getProfiles.query())

async function adjustScore(userId: string, genre: string, currentScore: number) {
  const newScore = prompt(`Nouveau score pour ${genre}:`, String(currentScore))
  if (newScore !== null) {
    await $trpc.analytics.updateProfileScore.mutate({ userId, genre, score: parseInt(newScore) })
    refresh()
  }
}
</script>

<template>
  <div class="p-8">
    <h1 class="text-2xl font-bold mb-6">Analyse Comportementale</h1>
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
