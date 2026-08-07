Pod::Spec.new do |s|
  s.name           = 'ExpoLocalSearch'
  s.version        = '1.0.0'
  s.summary        = 'Apple MKLocalSearch bridge for point-of-interest lookup'
  s.description    = 'Resolves place/building names to coordinates using MKLocalSearch, the same engine as the Maps app search bar.'
  s.license        = 'MIT'
  s.author         = 'Longhorn Loop'
  s.homepage       = 'https://longhorn-developers.workers.dev'
  s.platforms      = {
    :ios => '15.1'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
