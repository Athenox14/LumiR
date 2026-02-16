import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    'vue/require-default-prop': 'off',
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
})
