<script setup lang="ts">
const collapsed = useState('sidebar-collapsed', () => false)
</script>

<template>
  <div class="min-h-screen bg-background">
    <!-- Desktop sidebar -->
    <LayoutSidebar class="hidden lg:flex" />

    <!-- Main content -->
    <div
      :class="[
        'transition-all duration-300',
        'lg:ml-64',
        collapsed ? 'lg:ml-20' : 'lg:ml-64',
      ]"
    >
      <LayoutHeader />
      <main class="min-h-[calc(100vh-4rem)] pb-20 lg:pb-6">
        <slot />
      </main>
    </div>

    <!-- Mobile navigation -->
    <LayoutMobileNav />
  </div>
</template>
