// @ts-check
// Handcrafted trivia bank, grouped by category. Each question has one numeric answer, stored in base
// units (so 3.5 million is 3500000). The answers here are widely cited figures, but please check any you
// plan to rely on before a public release.
//
// To add a question, append it to the array for its category. To add a category, add a new array below
// and list it in BY_CATEGORY. Ids must stay unique across all categories, and answers must be above 0
// (the scoring divides by the answer). Questions should be estimates or specific figures, not famous
// facts with tight answers.

/** @type {Record<string, import('./trivia.js').Question[]>} */
const BY_CATEGORY = {
  Sports: [
    {id: 'olympic-rings', text: 'How many interlocking rings are on the Olympic flag?', answer: 5},
  ],

  Geography: [
    {id: 'africa-countries', text: 'How many countries are on the African continent?', answer: 54},
    {id: 'germany-neighbors', text: 'How many countries share a land border with Germany?', answer: 9},
    {id: 'russia-timezones', text: 'How many time zones does Russia span?', answer: 11},
    {id: 'earth-circumference', text: 'How many miles is Earth\'s circumference at the equator?', answer: 24901, label: 'miles'},
    {id: 'earth-surface-area', text: 'About how many square miles is Earth\'s total surface area?', answer: 196900000, label: 'sq mi'},
    {id: 'pacific-area', text: 'About how many square miles is the Pacific Ocean?', answer: 63800000, label: 'sq mi'},
    {id: 'everest-height', text: 'How tall is Mount Everest, in feet?', answer: 29032, label: 'ft'},
    {id: 'rainier-height', text: 'How many feet tall is Mount Rainier?', answer: 14411, label: 'ft'},
    {id: 'fuji-height', text: 'How many feet tall is Mount Fuji?', answer: 12389, label: 'ft'},
    {id: 'kilimanjaro-height', text: 'How many feet tall is Mount Kilimanjaro?', answer: 19341, label: 'ft'},
    {id: 'denali-height', text: 'How many feet tall is Denali (Mount McKinley)?', answer: 20310, label: 'ft'},
    {id: 'k2-height', text: 'How many feet tall is K2?', answer: 28251, label: 'ft'},
    {id: 'mariana-depth', text: 'About how many feet deep is the Challenger Deep in the Mariana Trench?', answer: 36070, label: 'ft'},
    {id: 'grand-canyon-depth', text: 'About how many feet deep is the Grand Canyon at its deepest point?', answer: 6093, label: 'ft'},
    {id: 'dead-sea-depth', text: 'About how many feet below sea level is the surface of the Dead Sea?', answer: 1412, label: 'ft'},
    {id: 'mississippi-length', text: 'About how many miles long is the Mississippi River?', answer: 2340, label: 'miles'},
    {id: 'lake-superior-area', text: 'About how many square miles is Lake Superior?', answer: 31700, label: 'sq mi'},
    {id: 'lake-michigan-area', text: 'About how many square miles is Lake Michigan?', answer: 22404, label: 'sq mi'},
    {id: 'texas-area', text: 'About how many square miles is Texas, including water?', answer: 268596, label: 'sq mi'},
    {id: 'alaska-area', text: 'About how many square miles is Alaska?', answer: 663268, label: 'sq mi'},
    {id: 'greenland-area', text: 'About how many square miles is Greenland?', answer: 836330, label: 'sq mi'},
    {id: 'madagascar-area', text: 'About how many square miles is Madagascar?', answer: 226658, label: 'sq mi'},
    {id: 'brazil-area', text: 'About how many square miles is Brazil?', answer: 3287612, label: 'sq mi'},
    {id: 'canada-area', text: 'About how many square miles is Canada, including water?', answer: 3855103, label: 'sq mi'},
    {id: 'australia-area', text: 'About how many square miles is Australia?', answer: 2969907, label: 'sq mi'},
    {id: 'appalachian-length', text: 'About how many miles long is the Appalachian Trail?', answer: 2198, label: 'miles'},
    {id: 'route66-length', text: 'About how many miles long was the original Route 66?', answer: 2448, label: 'miles'},
    {id: 'trans-siberian-length', text: 'About how many miles long is the Trans-Siberian Railway?', answer: 5772, label: 'miles'},
    {id: 'great-barrier-length', text: 'About how many miles long is the Great Barrier Reef?', answer: 1429, label: 'miles'},
    {id: 'burj-height', text: 'How many feet tall is the Burj Khalifa?', answer: 2717, label: 'ft'},
    {id: 'statue-liberty-height', text: 'About how many feet from the ground to the torch of the Statue of Liberty?', answer: 305, label: 'ft'},
    {id: 'golden-gate-span', text: 'About how many feet long is the main span of the Golden Gate Bridge?', answer: 4200, label: 'ft'},
    {id: 'hoover-height', text: 'About how many feet tall is the Hoover Dam?', answer: 726, label: 'ft'},
  ],

  Society: [
    {id: 'un-members', text: 'How many member states does the United Nations have?', answer: 193},
    {id: 'un-official-languages', text: 'How many official languages does the United Nations use?', answer: 6},
    {id: 'apollo-moon-landings', text: 'How many crewed Apollo missions landed on the Moon?', answer: 6},
  ],

  Population: [],

  Astronomy: [
    {id: 'speed-of-light', text: 'About how many miles per second does light travel?', answer: 186282, label: 'miles/s'},
    {id: 'earth-moon-distance', text: 'About how many miles is the Moon from Earth on average?', answer: 238855, label: 'miles'},
    {id: 'earth-sun-distance', text: 'About how many miles is Earth from the Sun on average?', answer: 92960000, label: 'miles'},
    {id: 'earth-age', text: 'About how many years old is the Earth?', answer: 4540000000, label: 'years'},
    {id: 'earth-equatorial-diameter', text: 'About how many miles across is Earth at the equator?', answer: 7926, label: 'miles'},
    {id: 'earth-polar-circumference', text: 'About how many miles is Earth\'s circumference through the poles?', answer: 24860, label: 'miles'},
    {id: 'jupiter-diameter', text: 'About how many miles across is Jupiter at its equator?', answer: 86881, label: 'miles'},
    {id: 'pluto-sun-distance', text: 'About how many miles is Pluto from the Sun on average?', answer: 3670000000, label: 'miles'},
  ],

  Science: [
    {id: 'bones-adult', text: 'How many bones are in the adult human body?', answer: 206},
    {id: 'skull-bones', text: 'How many bones are in an adult human skull, including the ear bones?', answer: 22},
    {id: 'adult-teeth', text: 'How many teeth does a healthy adult human normally have?', answer: 32},
    {id: 'chromosomes', text: 'How many chromosomes are in a typical human body cell?', answer: 46},
    {id: 'periodic-elements', text: 'How many chemical elements are on the periodic table (as of 2025)?', answer: 118},
    {id: 'sound-speed', text: 'About how many miles per hour does sound travel at sea level?', answer: 761, label: 'mph'},
  ],

  Culture: [
    {id: 'bible-books', text: 'How many books are in the Protestant Bible?', answer: 66},
    {id: 'piano-keys', text: 'How many keys does a standard piano have?', answer: 88},
    {id: 'shakespeare-plays', text: 'How many plays are generally attributed to William Shakespeare?', answer: 39},
    {id: 'chess-squares', text: 'How many squares are on a chessboard?', answer: 64},
  ],

  Everyday: [
    {id: 'leap-year-days', text: 'How many days are in a leap year?', answer: 366},
    {id: 'seconds-day', text: 'How many seconds are in one day?', answer: 86400},
    {id: 'minutes-week', text: 'How many minutes are in one week?', answer: 10080},
    {id: 'hours-year', text: 'How many hours are in a common (non-leap) year?', answer: 8760},
    {id: 'inches-mile', text: 'How many inches are in one mile?', answer: 63360},
    {id: 'grams-pound', text: 'How many grams are in one avoirdupois pound?', answer: 453.59, label: 'g'},
  ],
};

/**
 * Every question in one flat list, each tagged with its category name. The game reads from this list
 * and doesn't need to know about the grouping.
 * @type {import('./trivia.js').Question[]}
 */
export const QUESTIONS = Object.entries(BY_CATEGORY).flatMap(
  ([category, questions]) => questions.map(q => ({...q, category}))
);

/** Category names in display order, for any screen that wants to group questions. */
export const CATEGORIES = Object.keys(BY_CATEGORY);
