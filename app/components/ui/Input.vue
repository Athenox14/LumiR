<script setup lang="ts">
interface Props {
  modelValue?: string
  type?: string
  placeholder?: string
  label?: string
  error?: string
  disabled?: boolean
  required?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  type: 'text',
  placeholder: '',
  disabled: false,
  required: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const inputId = `input-${Math.random().toString(36).slice(2, 9)}`
</script>

<template>
  <div class="space-y-1.5">
    <label
      v-if="label"
      :for="inputId"
      class="block text-sm font-medium text-text-secondary"
    >
      {{ label }}
      <span v-if="required" class="text-red-500">*</span>
    </label>
    <input
      :id="inputId"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :required="required"
      :class="[
        'w-full px-4 py-2.5 rounded-lg transition-all duration-200',
        'bg-surface border text-text-primary placeholder-text-muted',
        'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        error ? 'border-red-500 focus:ring-red-500' : 'border-border hover:border-border-secondary',
      ]"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <p v-if="error" class="text-sm text-red-500">
      {{ error }}
    </p>
  </div>
</template>
