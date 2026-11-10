import ExpoModulesCore
import FamilyControls
import ManagedSettings
import DeviceActivity
import SwiftUI

private let appGroup = "group.az.unimate.app"
private let selectionKey = "focuslock.selection"
private let endAtKey = "focuslock.endAt"
private let storeName = ManagedSettingsStore.Name("unimate.focus")
private let activityName = DeviceActivityName("unimate.focus")

private func defaults() -> UserDefaults { UserDefaults(suiteName: appGroup) ?? .standard }

private func loadSelection() -> FamilyActivitySelection {
  guard let data = defaults().data(forKey: selectionKey),
        let sel = try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data)
  else { return FamilyActivitySelection() }
  return sel
}
private func saveSelection(_ sel: FamilyActivitySelection) {
  if let data = try? PropertyListEncoder().encode(sel) { defaults().set(data, forKey: selectionKey) }
}
private func selectionCount(_ s: FamilyActivitySelection) -> Int {
  s.applicationTokens.count + s.categoryTokens.count + s.webDomainTokens.count
}

private struct PickerView: View {
  @State var selection: FamilyActivitySelection
  let onDone: (FamilyActivitySelection) -> Void
  var body: some View {
    NavigationView {
      FamilyActivityPicker(selection: $selection)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("OK") { onDone(selection) } } }
    }
  }
}

public class UnimateFocusLockModule: Module {
  public func definition() -> ModuleDefinition {
    Name("UnimateFocusLock")

    AsyncFunction("getStatus") { () -> [String: Any] in
      let authorized = AuthorizationCenter.shared.authorizationStatus == .approved
      return [
        "platform": "ios", "supported": true, "authorized": authorized,
        "blockedCount": selectionCount(loadSelection()),
        "blocking": authorized && self.isShieldActive(),
      ]
    }

    AsyncFunction("requestAuthorization") { () async -> Bool in
      do { try await AuthorizationCenter.shared.requestAuthorization(for: .individual) } catch {}
      return AuthorizationCenter.shared.authorizationStatus == .approved
    }

    AsyncFunction("pickApps") { (promise: Promise) in
      DispatchQueue.main.async {
        guard let root = self.topController() else { promise.resolve(0); return }
        var host: UIViewController?
        let view = PickerView(selection: loadSelection()) { sel in
          saveSelection(sel)
          host?.dismiss(animated: true) { promise.resolve(selectionCount(sel)) }
        }
        host = UIHostingController(rootView: view)
        root.present(host!, animated: true)
      }
    }

    AsyncFunction("listApps") { () -> [[String: String]] in [] }
    AsyncFunction("setBlockedApps") { (_: [String]) in }

    AsyncFunction("startBlocking") { (endAtMs: Double) -> Bool in self.apply(endAtMs) }
    AsyncFunction("resumeBlocking") { (endAtMs: Double) -> Bool in self.apply(endAtMs) }
    AsyncFunction("stopBlocking") { () in self.clear(forgetEnd: true) }
    AsyncFunction("pauseBlocking") { () in self.clear(forgetEnd: false) }
  }

  private func isShieldActive() -> Bool {
    let store = ManagedSettingsStore(named: storeName)
    return store.shield.applications != nil || store.shield.applicationCategories != nil
      || store.shield.webDomains != nil
  }

  private func apply(_ endAtMs: Double) -> Bool {
    guard AuthorizationCenter.shared.authorizationStatus == .approved else { return false }
    let sel = loadSelection()
    guard selectionCount(sel) > 0, endAtMs > Date().timeIntervalSince1970 * 1000 else { return false }
    let store = ManagedSettingsStore(named: storeName)
    store.shield.applications = sel.applicationTokens.isEmpty ? nil : sel.applicationTokens
    store.shield.applicationCategories = sel.categoryTokens.isEmpty ? nil : .specific(sel.categoryTokens)
    store.shield.webDomains = sel.webDomainTokens.isEmpty ? nil : sel.webDomainTokens
    defaults().set(endAtMs, forKey: endAtKey)
    // Auto-clear at endAt via the DeviceActivityMonitor extension (intervalDidEnd).
    let cal = Calendar.current
    let comps: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
    let schedule = DeviceActivitySchedule(
      intervalStart: cal.dateComponents(comps, from: Date()),
      intervalEnd: cal.dateComponents(comps, from: Date(timeIntervalSince1970: endAtMs / 1000)),
      repeats: false)
    let center = DeviceActivityCenter()
    center.stopMonitoring([activityName])
    // If monitoring fails the shield stays until stopBlocking(); JS timer must call it.
    try? center.startMonitoring(activityName, during: schedule)
    return isShieldActive()
  }

  private func clear(forgetEnd: Bool) {
    DeviceActivityCenter().stopMonitoring([activityName])
    ManagedSettingsStore(named: storeName).clearAllSettings()
    if forgetEnd { defaults().removeObject(forKey: endAtKey) }
  }

  private func topController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    var vc = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController
    while let p = vc?.presentedViewController { vc = p }
    return vc
  }
}
