/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_EHR_CONNECT_API_BASE_URL?: string
  readonly VITE_EHR_CONNECT_API_KEY?: string
  readonly VITE_EHR_CONNECT_WORKFLOW_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
