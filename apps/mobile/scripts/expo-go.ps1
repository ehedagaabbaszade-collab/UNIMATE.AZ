# Dev server for Expo Go over a tunnel that restarts itself: the Expo tunnel service sometimes drops the
# connection with "Unexpected server response: 409" and the CLI exits. Ctrl+C twice stops it for good.
# Note: every restart gets a new tunnel address; the current one is printed above each QR code.
$first = $true
while ($true) {
  if ($first) { npx expo start --go --tunnel --clear } else { npx expo start --go --tunnel }
  $first = $false
  Write-Host "Expo exited (code $LASTEXITCODE); restarting in 3 s. Press Ctrl+C again to stop." -ForegroundColor Yellow
  Start-Sleep -Seconds 3
}
