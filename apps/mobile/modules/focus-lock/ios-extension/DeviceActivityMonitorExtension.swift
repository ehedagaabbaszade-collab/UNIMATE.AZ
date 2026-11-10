import DeviceActivity
import ManagedSettings
import Foundation

// Clears the shield when the focus interval ends, even if the app is not running.
class DeviceActivityMonitorExtension: DeviceActivityMonitor {
  override func intervalDidEnd(for activity: DeviceActivityName) {
    super.intervalDidEnd(for: activity)
    ManagedSettingsStore(named: ManagedSettingsStore.Name("unimate.focus")).clearAllSettings()
    UserDefaults(suiteName: "group.az.unimate.app")?.removeObject(forKey: "focuslock.endAt")
  }
}
