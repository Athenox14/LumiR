<script setup lang="ts">
interface Props {
  modelValue: boolean
  title?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
}

function close() {
  emit('update:modelValue', false)
}

// Close on escape key
onMounted(() => {
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && props.modelValue) {
      close()
    }
  }
  window.addEventListener('keydown', handleEscape)
  onUnmounted(() => window.removeEventListener('keydown', handleEscape))
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <!-- Backdrop -->
        <div
          class="absolute inset-0 bg-black/60 backdrop-blur-sm"
          @click="close"
        />

        <!-- Modal -->
        <Transition
          enter-active-class="transition-all duration-200"
          enter-from-class="opacity-0 scale-95"
          enter-to-class="opacity-100 scale-100"
          leave-active-class="transition-all duration-200"
          leave-from-class="opacity-100 scale-100"
          leave-to-class="opacity-0 scale-95"
        >
          <div
            v-if="modelValue"
            :class="[
              'relative w-full bg-surface border border-border rounded-xl shadow-2xl',
              sizeClasses[size],
            ]"
          >
            <!-- Header -->
            <div
              v-if="title || $slots.header"
              class="flex items-center justify-between px-6 py-4 border-b border-border"
            >
              <slot name="header">
                <h2 class="text-lg font-semibold text-text-primary">
                  {{ title }}
                </h2>
              </slot>
              <button
                type="button"
                class="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-secondary transition-colors"
                @click="close"
              >
                <svg
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <!-- Content -->
            <div class="px-6 py-4">
              <slot />
            </div>

            <!-- Footer -->
            <div
              v-if="$slots.footer"
              class="flex items-center justify-end gap-3 px-6 py-4 border-t border-border"
            >
              <slot name="footer" />
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
