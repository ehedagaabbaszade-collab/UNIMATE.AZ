package az.unimate.focuslock

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent

/** Only reads the package name of window-state events; never reads content or input. */
class FocusAccessibilityService : AccessibilityService() {
  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null || event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
    val pkg = event.packageName?.toString() ?: return
    if (pkg == packageName) return
    if (!FocusStore.isActive(this)) return
    if (pkg !in FocusStore.blockedApps(this)) return
    val i = Intent(this, BlockActivity::class.java).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    startActivity(i)
  }

  override fun onInterrupt() {}
}
