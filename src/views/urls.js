// City-scoped URLs (SPEC Flow 14). Parks and passports live under their city's key:
// /st-pete/parks, /westminster/parks/sigler-park, /westminster/passport.

/** A path in a city: cityPath(city, '/parks') -> "/westminster/parks"; cityPath(city) -> "/westminster". */
export const cityPath = (city, path = '') => `/${city.key}${path}`;

/** A park's page (or a path under it): needs the park's city_key and slug. */
export const parkPath = (park, suffix = '') => `/${park.city_key}/parks/${park.slug}${suffix}`;
