Pod::Spec.new do |s|
  s.name           = 'UnimateFocusLock'
  s.version        = '0.0.1'
  s.summary        = 'Focus lock via Screen Time API'
  s.homepage       = 'https://unimate.az'
  s.license        = 'UNLICENSED'
  s.author         = 'UNIMATE.AZ'
  s.platforms      = { :ios => '16.0' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
end
