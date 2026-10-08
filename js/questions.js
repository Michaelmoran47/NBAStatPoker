// @ts-check
// Handcrafted trivia bank, grouped by category. Each question has one numeric answer, stored in base
// units (so 3.5 million is 3500000). The answers here are widely cited figures, but please check any you
// plan to rely on before a public release.
//
// `spread` (optional, default 1) is a first-pass, subjective call on how much of a shot in the dark
// each question inherently is — see Question.spread in js/trivia.js for exactly what it does to the
// daily's scoring curve. Below 1 is a precise or widely-known fact (most people either know it or can
// pin it down closely); above 1 is a wide-range estimate nobody has real intuition for. It's only ever
// a guess at authoring time — adjust individual values once you've seen how a question actually plays.
//
// To add a question, append it to the array for its category. To add a category, add a new array below
// and list it in BY_CATEGORY. Ids must stay unique across all categories, and answers must be above 0
// (the scoring divides by the answer). Questions should be estimates or specific figures, not famous
// facts with tight answers.

/** @type {Record<string, import('./trivia.js').Question[]>} */
const BY_CATEGORY = {
  Sports: [
    {id: 'olympic-rings', text: 'How many interlocking rings are on the Olympic flag?', answer: 5, spread: 0.5},
  ],

  Geography: [
    {id: 'africa-countries', text: 'How many countries are on the African continent?', answer: 54},
    {id: 'germany-neighbors', text: 'How many countries share a land border with Germany?', answer: 9, spread: 0.8},
    {id: 'russia-timezones', text: 'How many time zones does Russia span?', answer: 11},
    {id: 'earth-circumference', text: 'How many miles is Earth\'s circumference at the equator?', answer: 24901, label: 'miles', spread: 0.7},
    {id: 'earth-surface-area', text: 'About how many square miles is Earth\'s total surface area?', answer: 196900000, label: 'sq mi', spread: 1.6},
    {id: 'pacific-area', text: 'About how many square miles is the Pacific Ocean?', answer: 63800000, label: 'sq mi', spread: 1.6},
    {id: 'everest-height', text: 'How tall is Mount Everest, in feet?', answer: 29032, label: 'ft', spread: 0.6},
    {id: 'rainier-height', text: 'How many feet tall is Mount Rainier?', answer: 14411, label: 'ft'},
    {id: 'fuji-height', text: 'How many feet tall is Mount Fuji?', answer: 12389, label: 'ft', spread: 1.1},
    {id: 'kilimanjaro-height', text: 'How many feet tall is Mount Kilimanjaro?', answer: 19341, label: 'ft', spread: 0.9},
    {id: 'denali-height', text: 'How many feet tall is Denali (Mount McKinley)?', answer: 20310, label: 'ft'},
    {id: 'k2-height', text: 'How many feet tall is K2?', answer: 28251, label: 'ft', spread: 0.9},
    {id: 'mariana-depth', text: 'About how many feet deep is the Challenger Deep in the Mariana Trench?', answer: 36070, label: 'ft', spread: 0.9},
    {id: 'grand-canyon-depth', text: 'About how many feet deep is the Grand Canyon at its deepest point?', answer: 6093, label: 'ft', spread: 1.2},
    {id: 'dead-sea-depth', text: 'About how many feet below sea level is the surface of the Dead Sea?', answer: 1412, label: 'ft'},
    {id: 'mississippi-length', text: 'About how many miles long is the Mississippi River?', answer: 2340, label: 'miles'},
    {id: 'lake-superior-area', text: 'About how many square miles is Lake Superior?', answer: 31700, label: 'sq mi', spread: 1.4},
    {id: 'lake-michigan-area', text: 'About how many square miles is Lake Michigan?', answer: 22404, label: 'sq mi', spread: 1.4},
    {id: 'texas-area', text: 'About how many square miles is Texas, including water?', answer: 268596, label: 'sq mi', spread: 0.8},
    {id: 'alaska-area', text: 'About how many square miles is Alaska?', answer: 663268, label: 'sq mi'},
    {id: 'greenland-area', text: 'About how many square miles is Greenland?', answer: 836330, label: 'sq mi', spread: 1.3},
    {id: 'madagascar-area', text: 'About how many square miles is Madagascar?', answer: 226658, label: 'sq mi', spread: 1.5},
    {id: 'brazil-area', text: 'About how many square miles is Brazil?', answer: 3287612, label: 'sq mi', spread: 1.2},
    {id: 'canada-area', text: 'About how many square miles is Canada, including water?', answer: 3855103, label: 'sq mi'},
    {id: 'australia-area', text: 'About how many square miles is Australia?', answer: 2969907, label: 'sq mi', spread: 1.1},
    {id: 'appalachian-length', text: 'About how many miles long is the Appalachian Trail?', answer: 2198, label: 'miles', spread: 1.3},
    {id: 'route66-length', text: 'About how many miles long was the original Route 66?', answer: 2448, label: 'miles', spread: 1.1},
    {id: 'trans-siberian-length', text: 'About how many miles long is the Trans-Siberian Railway?', answer: 5772, label: 'miles', spread: 1.4},
    {id: 'great-barrier-length', text: 'About how many miles long is the Great Barrier Reef?', answer: 1429, label: 'miles', spread: 1.1},
    {id: 'burj-height', text: 'How many feet tall is the Burj Khalifa?', answer: 2717, label: 'ft', spread: 0.8},
    {id: 'statue-liberty-height', text: 'About how many feet from the ground to the torch of the Statue of Liberty?', answer: 305, label: 'ft'},
    {id: 'golden-gate-span', text: 'About how many feet long is the main span of the Golden Gate Bridge?', answer: 4200, label: 'ft', spread: 1.2},
    {id: 'hoover-height', text: 'About how many feet tall is the Hoover Dam?', answer: 726, label: 'ft', spread: 1.3},
  ],

  Society: [
    {id: 'un-members', text: 'How many member states does the United Nations have?', answer: 193, spread: 0.7},
    {id: 'un-official-languages', text: 'How many official languages does the United Nations use?', answer: 6, spread: 0.7},
    {id: 'apollo-moon-landings', text: 'How many crewed Apollo missions landed on the Moon?', answer: 6},
  ],

  Population: [],

  Astronomy: [
    {id: 'speed-of-light', text: 'About how many miles per second does light travel?', answer: 186282, label: 'miles/s', spread: 0.6},
    {id: 'earth-moon-distance', text: 'About how many miles is the Moon from Earth on average?', answer: 238855, label: 'miles', spread: 0.7},
    {id: 'earth-sun-distance', text: 'About how many miles is Earth from the Sun on average?', answer: 92960000, label: 'miles', spread: 0.8},
    {id: 'earth-age', text: 'About how many years old is the Earth?', answer: 4540000000, label: 'years', spread: 0.6},
    {id: 'earth-equatorial-diameter', text: 'About how many miles across is Earth at the equator?', answer: 7926, label: 'miles'},
    {id: 'earth-polar-circumference', text: 'About how many miles is Earth\'s circumference through the poles?', answer: 24860, label: 'miles', spread: 1.3},
    {id: 'jupiter-diameter', text: 'About how many miles across is Jupiter at its equator?', answer: 86881, label: 'miles', spread: 1.3},
    {id: 'pluto-sun-distance', text: 'About how many miles is Pluto from the Sun on average?', answer: 3670000000, label: 'miles', spread: 1.7},
  ],

  Science: [
    {id: 'bones-adult', text: 'How many bones are in the adult human body?', answer: 206, spread: 0.5},
    {id: 'skull-bones', text: 'How many bones are in an adult human skull, including the ear bones?', answer: 22, spread: 1.3},
    {id: 'adult-teeth', text: 'How many teeth does a healthy adult human normally have?', answer: 32, spread: 0.6},
    {id: 'chromosomes', text: 'How many chromosomes are in a typical human body cell?', answer: 46, spread: 0.6},
    {id: 'periodic-elements', text: 'How many chemical elements are on the periodic table (as of 2025)?', answer: 118, spread: 0.8},
    {id: 'sound-speed', text: 'About how many miles per hour does sound travel at sea level?', answer: 761, label: 'mph'},
  ],

  Culture: [
    {id: 'bible-books', text: 'How many books are in the Protestant Bible?', answer: 66},
    {id: 'piano-keys', text: 'How many keys does a standard piano have?', answer: 88, spread: 0.5},
    {id: 'shakespeare-plays', text: 'How many plays are generally attributed to William Shakespeare?', answer: 39},
    {id: 'chess-squares', text: 'How many squares are on a chessboard?', answer: 64, spread: 0.5},
  ],

  Everyday: [
    {id: 'leap-year-days', text: 'How many days are in a leap year?', answer: 366, spread: 0.4},
    {id: 'seconds-day', text: 'How many seconds are in one day?', answer: 86400, spread: 0.7},
    {id: 'minutes-week', text: 'How many minutes are in one week?', answer: 10080, spread: 0.9},
    {id: 'hours-year', text: 'How many hours are in a common (non-leap) year?', answer: 8760, spread: 0.8},
    {id: 'inches-mile', text: 'How many inches are in one mile?', answer: 63360, spread: 1.1},
    {id: 'grams-pound', text: 'How many grams are in one avoirdupois pound?', answer: 453.59, label: 'g', spread: 0.8},
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
