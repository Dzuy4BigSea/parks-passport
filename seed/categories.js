// Maps a raw City "Park Features" value to zero or more category slugs, by keyword.
// See seed/park-features.txt for every raw value and what it maps to.
export const CATEGORIES = {
  'playground': 'Playground',
  'dog-park': 'Dog park',
  'restrooms': 'Restrooms',
  'picnic-shelter': 'Picnic shelter',
  'trails': 'Trails',
  'tennis': 'Tennis',
  'pickleball': 'Pickleball',
  'basketball': 'Basketball',
  'ball-fields': 'Ball fields',
  'water-access': 'Boat & kayak access',
  'beach': 'Beach',
  'lake': 'Lake',
  'scenic-view': 'Scenic view',
  'pool': 'Pool & splash pad',
  'fitness': 'Fitness',
  'recreation-center': 'Recreation center',
  'history-nature': 'History & nature',
  'skatepark': 'Skatepark',
};

const RULES = [
  [/playground|playlot|swing/, 'playground'],
  [/dog park/, 'dog-park'],
  [/restroom/, 'restrooms'],
  [/shelter|pavill?ion|picnic|gazebo|grill|shade-covered|arbor\b/, 'picnic-shelter'],
  [/trail/, 'trails'],
  [/tennis/, 'tennis'],
  [/pickleball/, 'pickleball'],
  [/basketball|baseketball/, 'basketball'],
  [/baseball|softball|soccer|cricket|sports complex|volleyball/, 'ball-fields'],
  [/boat ramp|kayak|canoe|paddling|fishing pier|blue ways/, 'water-access'],
  [/beach/, 'beach'],
  [/\blake\b/, 'lake'],
  [/scenic/, 'scenic-view'],
  [/pool|aquatic|splash pad/, 'pool'],
  [/exercise zone|fitness|climbing/, 'fitness'],
  [/recreation center|tasco center/, 'recreation-center'],
  [/historic|midden|arboretum|estuary|community garden|bat box|sundial|sculpture|statue/, 'history-nature'],
  [/skatepark|skate park/, 'skatepark'],
];

export function featureToCategories(feature) {
  const f = feature.toLowerCase();
  return RULES.filter(([re]) => re.test(f)).map(([, slug]) => slug);
}
