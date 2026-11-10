package az.unimate.focuslock

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class UnimateFocusLockModule : Module() {
  private val ctx get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun status(): Map<String, Any> {
    val authorized = FocusStore.isAccessibilityEnabled(ctx)
    val count = FocusStore.blockedApps(ctx).size
    val m = mutableMapOf<String, Any>(
      "platform" to "android",
      "supported" to true,
      "authorized" to authorized,
      "blockedCount" to count,
      "blocking" to (authorized && count > 0 && FocusStore.isActive(ctx))
    )
    if (!authorized) m["reason"] = "accessibility_service_disabled"
    else if (count == 0) m["reason"] = "no_apps_selected"
    return m
  }

  private fun canBlock() = FocusStore.isAccessibilityEnabled(ctx) && FocusStore.blockedApps(ctx).isNotEmpty()

  private fun open(intent: Intent) {
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    ctx.startActivity(intent)
  }

  override fun definition() = ModuleDefinition {
    Name("UnimateFocusLock")

    AsyncFunction("getStatus") { status() }

    AsyncFunction("requestAuthorization") {
      // Opens one settings screen per call; the user returns and JS re-reads getStatus().
      // Order: accessibility service (required) first; overlay permission after.
      when {
        !FocusStore.isAccessibilityEnabled(ctx) ->
          open(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        !Settings.canDrawOverlays(ctx) ->
          open(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}")))
      }
      FocusStore.isAccessibilityEnabled(ctx)
    }

    AsyncFunction("pickApps") { 0 }

    AsyncFunction("listApps") {
      val pm = ctx.packageManager
      val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      pm.queryIntentActivities(launcher, 0)
        .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
        .filter { it.first != ctx.packageName }
        .distinctBy { it.first }
        .sortedBy { it.second.lowercase() }
        .map { mapOf("id" to it.first, "label" to it.second) }
    }

    AsyncFunction("setBlockedApps") { ids: List<String> ->
      FocusStore.setBlockedApps(ctx, ids.filter { it != ctx.packageName })
    }

    AsyncFunction("startBlocking") { endAtMs: Double ->
      if (!canBlock() || endAtMs <= System.currentTimeMillis()) return@AsyncFunction false
      FocusStore.start(ctx, endAtMs.toLong())
      true
    }

    AsyncFunction("resumeBlocking") { endAtMs: Double ->
      if (!canBlock() || endAtMs <= System.currentTimeMillis()) return@AsyncFunction false
      FocusStore.start(ctx, endAtMs.toLong())
      true
    }

    AsyncFunction("stopBlocking") { FocusStore.stop(ctx) }
    AsyncFunction("pauseBlocking") { FocusStore.pause(ctx) }
  }
}
