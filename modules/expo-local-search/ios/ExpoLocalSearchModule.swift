import ExpoModulesCore
import MapKit

// Bridges Apple's MKLocalSearch — the same point-of-interest engine that powers
// the Maps app search bar — to JavaScript. Unlike a plain geocoder, it resolves
// business/landmark/building names (e.g. "Texas Union Ballroom") to coordinates.
public class ExpoLocalSearchModule: Module {
  public func definition() -> ModuleDefinition {
    // Accessible from JS as requireNativeModule('ExpoLocalSearch').
    Name("ExpoLocalSearch")

    // search(query, options?) -> [{ name, latitude, longitude, address }]
    //
    // options.latitude/longitude/radiusMeters bias results toward a region
    // (we pass UT Austin's center so campus buildings win over lookalikes
    // elsewhere). Results come back ranked the way the Maps app ranks them.
    AsyncFunction("search") { (query: String, options: [String: Any]?, promise: Promise) in
      let request = MKLocalSearch.Request()
      request.naturalLanguageQuery = query

      if let options = options,
         let lat = options["latitude"] as? Double,
         let lng = options["longitude"] as? Double {
        let radius = (options["radiusMeters"] as? Double) ?? 5000
        request.region = MKCoordinateRegion(
          center: CLLocationCoordinate2D(latitude: lat, longitude: lng),
          latitudinalMeters: radius,
          longitudinalMeters: radius
        )
      }

      let search = MKLocalSearch(request: request)
      search.start { response, error in
        if let error = error {
          promise.reject("E_LOCAL_SEARCH", error.localizedDescription)
          return
        }
        let items = response?.mapItems ?? []
        let results: [[String: Any]] = items.map { item in
          let coord = item.placemark.coordinate
          return [
            "name": item.name ?? query,
            "latitude": coord.latitude,
            "longitude": coord.longitude,
            "address": Self.formatAddress(item.placemark),
          ]
        }
        promise.resolve(results)
      }
    }
  }

  // Compose a human-readable address from the placemark's parts, skipping any
  // that are missing so we never emit stray commas.
  private static func formatAddress(_ placemark: MKPlacemark) -> String {
    let parts = [
      placemark.subThoroughfare,
      placemark.thoroughfare,
      placemark.locality,
      placemark.administrativeArea,
    ].compactMap { $0 }
    return parts.joined(separator: ", ")
  }
}
