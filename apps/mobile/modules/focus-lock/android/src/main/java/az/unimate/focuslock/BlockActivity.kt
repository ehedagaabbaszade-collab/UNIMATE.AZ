package az.unimate.focuslock

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Full-screen block screen. The Emergency Exit button is always visible. */
class BlockActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val pad = (24 * resources.displayMetrics.density).toInt()
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.parseColor("#111827"))
      setPadding(pad, pad, pad, pad)
    }
    root.addView(TextView(this).apply {
      text = getString(R.string.unimate_focus_lock_title)
      textSize = 24f
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
    })
    root.addView(TextView(this).apply {
      text = getString(R.string.unimate_focus_lock_body)
      textSize = 16f
      setTextColor(Color.LTGRAY)
      gravity = Gravity.CENTER
      setPadding(0, pad / 2, 0, pad)
    })
    root.addView(Button(this).apply {
      text = getString(R.string.unimate_focus_lock_emergency)
      setOnClickListener {
        FocusStore.stop(this@BlockActivity)
        goHome()
      }
    })
    setContentView(root)
  }

  override fun onResume() {
    super.onResume()
    if (!FocusStore.isActive(this)) goHome()
  }

  @Deprecated("Back returns home instead of back into the blocked app")
  override fun onBackPressed() = goHome()

  private fun goHome() {
    startActivity(Intent(Intent.ACTION_MAIN).apply {
      addCategory(Intent.CATEGORY_HOME)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    })
    finish()
  }
}
