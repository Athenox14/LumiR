<script setup lang="ts">
interface Props {
  width?: string
  height?: string
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full'
}

withDefaults(defineProps<Props>(), {
  rounded: 'md',
})

const roundedClasses = {
  none: 'rounded-none',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  full: 'rounded-full',
}
</script>

<template>
  <div
    :class="['bg-surface-secondary animate-pulse', roundedClasses[rounded]]"
    :style="{
      width: width || '100%',
      height: height || '1rem',
    }"
  />
</template>
