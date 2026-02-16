<script setup lang="ts">
definePageMeta({
  middleware: ['auth'],
})

const { t } = useI18n()
const route = useRoute()
const trpc = useTrpc()

const personId = computed(() => Number(route.params.id))

const { data: person, pending, error } = useAsyncData(
  `person-${personId.value}`,
  () => trpc.catalog.personInfo.query({ personId: personId.value })
)

function formatDate(date: string | null): string {
  if (!date) return ''
  try {
    const { locale } = useI18n()
    return new Date(date).toLocaleDateString(locale.value === 'fr' ? 'fr-FR' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch {
    return date
  }
}

function calculateAge(birthday: string | null, deathday: string | null): number | null {
  if (!birthday) return null
  const birth = new Date(birthday)
  const end = deathday ? new Date(deathday) : new Date()
  let age = end.getFullYear() - birth.getFullYear()
  const m = end.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && end.getDate() < birth.getDate())) age--
  return age
}

function getMediaLink(credit: { id: number; type: string }): string {
  return credit.type === 'TV Series'
    ? `/catalog/tv/${credit.id}`
    : `/catalog/movie/${credit.id}`
}

const placeholderProfile = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"%3E%3Crect fill="%231a1a1a" width="300" height="450"/%3E%3Ctext fill="%23404040" font-family="sans-serif" font-size="24" text-anchor="middle" x="150" y="225"%3ENo Photo%3C/text%3E%3C/svg%3E'
</script>

<template>
  <div class="min-h-screen">
    <!-- Loading -->
    <div v-if="pending" class="p-6">
      <div class="max-w-4xl mx-auto flex gap-8">
        <UiSkeleton class="w-48 h-72 rounded-xl flex-shrink-0" />
        <div class="flex-1 space-y-4">
          <UiSkeleton height="2rem" width="60%" />
          <UiSkeleton height="1rem" width="30%" />
          <UiSkeleton height="8rem" />
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="p-6 text-center">
      <p class="text-red-500">{{ t('person.failedToLoad') }}</p>
      <NuxtLink to="/catalog" class="text-primary hover:underline mt-2 inline-block">
        {{ t('person.backToCatalog') }}
      </NuxtLink>
    </div>

    <!-- Content -->
    <div v-else-if="person" class="max-w-5xl mx-auto px-6 py-8">
      <!-- Header -->
      <div class="flex flex-col md:flex-row gap-8 mb-10">
        <!-- Photo -->
        <div class="flex-shrink-0">
          <div class="w-48 h-72 rounded-xl overflow-hidden bg-surface">
            <img
              v-if="person.profilePath"
              :src="person.profilePath"
              :alt="person.name"
              class="w-full h-full object-cover"
            >
            <img v-else :src="placeholderProfile" alt="" class="w-full h-full object-cover" >
          </div>
        </div>

        <!-- Info -->
        <div class="flex-1">
          <h1 class="text-3xl md:text-4xl font-bold text-text-primary mb-3">
            {{ person.name }}
          </h1>

          <div class="flex flex-wrap items-center gap-3 text-text-secondary mb-4">
            <span v-if="person.knownForDepartment" class="px-2 py-0.5 bg-primary/20 text-primary rounded text-sm">
              {{ person.knownForDepartment }}
            </span>
            <span v-if="person.birthday">
              {{ formatDate(person.birthday) }}
              <template v-if="!person.deathday && calculateAge(person.birthday, null) !== null">
                ({{ t('person.yearsOld', { age: calculateAge(person.birthday, null) }) }})
              </template>
            </span>
            <span v-if="person.deathday" class="text-text-muted">
              - {{ formatDate(person.deathday) }} ({{ t('person.yearsOld', { age: calculateAge(person.birthday, person.deathday) }) }})
            </span>
            <span v-if="person.placeOfBirth" class="text-text-muted">
              {{ person.placeOfBirth }}
            </span>
          </div>

          <p v-if="person.biography" class="text-text-secondary leading-relaxed whitespace-pre-line">
            {{ person.biography }}
          </p>
          <p v-else class="text-text-muted italic">{{ t('person.noBio') }}</p>
        </div>
      </div>

      <!-- Filmography -->
      <div v-if="person.credits?.length">
        <h2 class="text-xl font-semibold text-text-primary mb-4">{{ t('person.filmography') }}</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <NuxtLink
            v-for="credit in person.credits"
            :key="`${credit.type}-${credit.id}`"
            :to="getMediaLink(credit)"
            class="group block"
          >
            <div class="aspect-[2/3] rounded-xl overflow-hidden bg-surface">
              <img
                v-if="credit.image"
                :src="credit.image"
                :alt="credit.title"
                class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              >
              <div v-else class="w-full h-full flex items-center justify-center">
                <svg class="w-10 h-10 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                </svg>
              </div>
            </div>
            <div class="mt-2 px-1">
              <p class="text-sm font-medium text-text-primary truncate group-hover:text-primary transition-colors">
                {{ credit.title }}
              </p>
              <p v-if="credit.character" class="text-xs text-text-muted truncate">{{ credit.character }}</p>
              <div class="flex items-center gap-2 mt-0.5">
                <span class="text-xs text-text-muted">{{ credit.releaseDate?.substring(0, 4) }}</span>
                <span v-if="credit.rating" class="text-xs text-text-muted flex items-center gap-0.5">
                  <svg class="w-3 h-3 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  {{ credit.rating.toFixed(1) }}
                </span>
                <span class="text-xs px-1.5 py-0.5 rounded bg-surface-secondary text-text-muted">
                  {{ credit.type === 'TV Series' ? t('person.series') : t('person.film') }}
                </span>
              </div>
            </div>
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
