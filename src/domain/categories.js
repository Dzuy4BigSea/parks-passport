// Filterable park categories (slug -> label). seed/categories.js maps City features onto these.
export const CATEGORIES = {
  'playground': 'Playground',
  'picnic-shelter': 'Picnic shelter',
  'trails': 'Trails',
  'ball-fields': 'Ball fields',
  'scenic-view': 'Scenic view',
  'basketball': 'Basketball',
  'restrooms': 'Restrooms',
  'tennis': 'Tennis',
  'pickleball': 'Pickleball',
  'history-nature': 'History & nature',
  'water-access': 'Boat & kayak access',
  'recreation-center': 'Recreation center',
  'fitness': 'Fitness',
  'lake': 'Lake',
  'dog-park': 'Dog park',
  'pool': 'Pool & splash pad',
  'skatepark': 'Skatepark',
  'beach': 'Beach',
  'shuffleboard': 'Shuffleboard',
};

export const categoryLabel = (slug) => CATEGORIES[slug] || slug;
