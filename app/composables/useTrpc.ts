export function useTrpc() {
  const { $trpc } = useNuxtApp()
  return $trpc
}
