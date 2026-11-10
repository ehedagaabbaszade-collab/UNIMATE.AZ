package az.unimate.focuslock

import android.content.Context
import android.provider.Settings

/** Shared state between the Expo module, the accessibility service and the block activity. */
object FocusStore {
  private const val PREFS = "unimate_focus_lock"
  private const val K_APPS = "blocked_apps"
  private const val K_END = "end_at"
  private const val K_PAUSED = "paused"

  private fun p(c: Context) = c.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun blockedApps(c: Context): Set<String> = p(c).getStringSet(K_APPS, emptySet()) ?: emptySet()
  fun setBlockedApps(c: Context, ids: Collection<String>) {
    p(c).edit().putStringSet(K_APPS, ids.toSet()).apply()
  }

  fun endAt(c: Context): Long = p(c).getLong(K_END, 0L)
  fun isPaused(c: Context): Boolean = p(c).getBoolean(K_PAUSED, false)

  fun start(c: Context, endAtMs: Long) {
    p(c).edit().putLong(K_END, endAtMs).putBoolean(K_PAUSED, false).apply()
  }
  fun pause(c: Context) { p(c).edit().putBoolean(K_PAUSED, true).apply() }
  fun stop(c: Context) { p(c).edit().putLong(K_END, 0L).putBoolean(K_PAUSED, false).apply() }

  /** True while a session is running, not paused and not expired. */
  fun isActive(c: Context): Boolean =
    !isPaused(c) && endAt(c) > System.currentTimeMillis()

  fun isAccessibilityEnabled(c: Context): Boolean {
    val enabled = Settings.Secure.getString(
      c.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    ) ?: return false
    val me = "${c.packageName}/${FocusAccessibilityService::class.java.name}"
    return enabled.split(':').any { it.equals(me, ignoreCase = true) }
  }
}
