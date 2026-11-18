import { SettingsForm } from './SettingsForm.jsx'

/** Settings → Plugins → Officecraft: the very form of the gear's window (tabs, one line per setting), framed as a card. Nothing else. */
export function SettingsPage() {
  return (
    <div className="oc-sf-page">
      <SettingsForm />
    </div>
  )
}
