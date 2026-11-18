import { en } from './en.js'
import { es } from './es.js'
import { fr } from './fr.js'

export const messages = { en, fr, es }

/** Language names are shown in their own language (endonyms), never translated. */
export const ENDONYMS = Object.freeze({ en: 'English', fr: 'Français', es: 'Español' })
