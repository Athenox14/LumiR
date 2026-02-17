import { Notyf } from 'notyf'
import 'notyf/notyf.min.css'

let notyf: Notyf | null = null

function getNotyf(): Notyf {
  if (!notyf && import.meta.client) {
    notyf = new Notyf({
      duration: 4000,
      position: { x: 'right', y: 'bottom' },
      dismissible: true,
      ripple: false,
    })
  }
  return notyf!
}

export function useToast() {
  return {
    success: (message: string) => getNotyf()?.success(message),
    error: (message: string) => getNotyf()?.error(message),
  }
}
