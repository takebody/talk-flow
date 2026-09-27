/// <reference types="vite/client" />

import type { TalkFlowApi } from '../../preload'

declare global {
  interface Window {
    talkflow: TalkFlowApi
  }
}

export {}
