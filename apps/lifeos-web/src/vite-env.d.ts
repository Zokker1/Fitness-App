/// <reference types="vite/client" />

// T029: sallitut julkiset env-avaimet. Uusi VITE_-avain lisätään ensin
// @lifeos/config ALLOWED_VITE_KEYS-katselmukseen ennen kuin se tuodaan tähän.
interface ImportMetaEnv {
  readonly VITE_APP_ORIGIN: string;
  readonly VITE_GOOGLE_CLIENT_ID: string;
}
