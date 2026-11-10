'use strict';
// Config plugin for modules/focus-lock. Plain CommonJS. Not exercised by a real prebuild yet.
const { withEntitlementsPlist, withAndroidManifest } = require('@expo/config-plugins');

const APP_GROUP = 'group.az.unimate.app';
const ANDROID_PERMISSIONS = [
  'android.permission.PACKAGE_USAGE_STATS',
  'android.permission.SYSTEM_ALERT_WINDOW',
  // FOREGROUND_SERVICE omitted on purpose: blocker is an AccessibilityService, no FGS is started.
];

function withIosEntitlements(config) {
  return withEntitlementsPlist(config, (cfg) => {
    cfg.modResults['com.apple.developer.family-controls'] = true;
    const groups = new Set(cfg.modResults['com.apple.security.application-groups'] || []);
    groups.add(APP_GROUP);
    cfg.modResults['com.apple.security.application-groups'] = [...groups];
    return cfg;
  });
}

function withAndroidFocusLock(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    for (const name of ANDROID_PERMISSIONS) {
      if (!manifest['uses-permission'].some((p) => p.$['android:name'] === name)) {
        manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    }
    // Package visibility so PackageManager can list launchable apps without QUERY_ALL_PACKAGES.
    manifest.queries = manifest.queries || [];
    const hasLauncherQuery = manifest.queries.some((q) =>
      (q.intent || []).some((i) =>
        (i.category || []).some((c) => c.$['android:name'] === 'android.intent.category.LAUNCHER'),
      ),
    );
    if (!hasLauncherQuery) {
      manifest.queries.push({
        intent: [
          {
            action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
            category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
          },
        ],
      });
    }
    // The accessibility service and BlockActivity are declared in the module's own
    // AndroidManifest.xml and merged by Gradle.
    return cfg;
  });
}

module.exports = function withFocusLock(config) {
  config = withIosEntitlements(config);
  config = withAndroidFocusLock(config);
  return config;
};
