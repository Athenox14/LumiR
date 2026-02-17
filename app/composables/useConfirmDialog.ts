const isOpen = ref(false)
const dialogTitle = ref('')
const dialogMessage = ref('')
let resolvePromise: ((value: boolean) => void) | null = null

export function useConfirmDialog() {
  function confirm(opts: { title: string; message: string }): Promise<boolean> {
    dialogTitle.value = opts.title
    dialogMessage.value = opts.message
    isOpen.value = true
    return new Promise<boolean>((resolve) => {
      resolvePromise = resolve
    })
  }

  function accept() {
    isOpen.value = false
    resolvePromise?.(true)
    resolvePromise = null
  }

  function cancel() {
    isOpen.value = false
    resolvePromise?.(false)
    resolvePromise = null
  }

  return { isOpen, dialogTitle, dialogMessage, confirm, accept, cancel }
}
