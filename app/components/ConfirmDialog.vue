<script setup lang="ts">
const { t } = useI18n()
const { isOpen, dialogTitle, dialogMessage, accept, cancel } = useConfirmDialog()
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isOpen"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="cancel"
      >
        <div class="bg-surface border border-border rounded-2xl w-full max-w-sm mx-4 p-6">
          <h3 class="font-semibold text-text-primary text-lg mb-2">{{ dialogTitle }}</h3>
          <p class="text-sm text-text-secondary mb-6">{{ dialogMessage }}</p>
          <div class="flex items-center justify-end gap-3">
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-primary hover:bg-surface-secondary rounded-lg transition-colors"
              @click="cancel"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/80 rounded-lg transition-colors"
              @click="accept"
            >
              {{ t('common.confirm') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
