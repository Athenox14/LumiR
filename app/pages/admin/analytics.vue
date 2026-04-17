<script setup lang="ts">
definePageMeta({ middleware: 'admin' })

await navigateTo('/admin/settings', { replace: true })
</script>
