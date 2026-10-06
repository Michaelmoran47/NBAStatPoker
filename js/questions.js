// @ts-check
// Handcrafted trivia bank. Each question has one numeric answer, stored in base units (so 3.5 million is
// 3500000). The answers here are widely cited figures, but please check any you plan to rely on before
// a public release. Add questions by appending to QUESTIONS. Ids must stay unique, and answers must
// be above 0 (the scoring divides by the answer).

/** @type {import('./trivia.js').Question[]} */
export const QUESTIONS = [
  {id: 'bones-adult', text: 'How many bones are in the adult human body?', answer: 206},
  {id: 'bible-books', text: 'How many books are in the Protestant Bible?', answer: 66},
  {id: 'un-members', text: 'How many member states does the United Nations have?', answer: 193},
  {id: 'piano-keys', text: 'How many keys does a standard piano have?', answer: 88},
  {id: 'adult-teeth', text: 'How many teeth does a healthy adult human normally have?', answer: 32},
  {id: 'chromosomes', text: 'How many chromosomes are in a typical human body cell?', answer: 46},
  {id: 'earth-circumference', text: 'How many miles is Earth\'s circumference at the equator?', answer: 24901, label: 'miles'},
  {id: 'speed-of-light', text: 'What is the speed of light in kilometers per second?', answer: 299792, label: 'km/s'},
  {id: 'everest-height', text: 'How tall is Mount Everest, in meters?', answer: 8849, label: 'm'},
  {id: 'russia-timezones', text: 'How many time zones does Russia span?', answer: 11},
  {id: 'leap-year-days', text: 'How many days are in a leap year?', answer: 366},
  {id: 'chess-squares', text: 'How many squares are on a chessboard?', answer: 64},
  {id: 'periodic-elements', text: 'How many chemical elements are on the periodic table (as of 2025)?', answer: 118},
  {id: 'inches-mile', text: 'How many inches are in one mile?', answer: 63360},
  {id: 'seconds-day', text: 'How many seconds are in one day?', answer: 86400},
  {id: 'minutes-week', text: 'How many minutes are in one week?', answer: 10080},
  {id: 'hours-year', text: 'How many hours are in a common (non-leap) year?', answer: 8760},
  {id: 'africa-countries', text: 'How many countries are on the African continent?', answer: 54},
  {id: 'harry-potter-books', text: 'How many books are in the original Harry Potter series?', answer: 7},
  {id: 'olympic-rings', text: 'How many interlocking rings are on the Olympic flag?', answer: 5},
  {id: 'grams-pound', text: 'How many grams are in one avoirdupois pound?', answer: 453.59, label: 'g'},
  {id: 'earth-sun-distance', text: 'About how many miles is Earth from the Sun on average?', answer: 92960000, label: 'miles'},
  {id: 'earth-moon-distance', text: 'About how many kilometers is the Moon from Earth on average?', answer: 384400, label: 'km'},
  {id: 'earth-surface-area', text: 'About how many square miles is Earth\'s total surface area?', answer: 196900000, label: 'sq mi'},
  {id: 'earth-age', text: 'About how many years old is the Earth?', answer: 4540000000, label: 'years'},
  {id: 'pacific-area', text: 'About how many square kilometers is the Pacific Ocean?', answer: 165250000, label: 'km²'},
  {id: 'skull-bones', text: 'How many bones are in an adult human skull, including the ear bones?', answer: 22},
  {id: 'apollo-moon-landings', text: 'How many crewed Apollo missions landed on the Moon?', answer: 6},
  {id: 'germany-neighbors', text: 'How many countries share a land border with Germany?', answer: 9},
  {id: 'un-official-languages', text: 'How many official languages does the United Nations use?', answer: 6},
  {id: 'shakespeare-plays', text: 'How many plays are generally attributed to William Shakespeare?', answer: 39},
];
