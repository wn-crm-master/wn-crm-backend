const SPECIAL_FIELDS = [
  'name',              // Author Name
  'regnDate',          // Author Reg. Date
  'locale',            // Author Locale
  'email',             // Author Email ID
  'phone',             // Author Phone No.
  'bucketTag',         // Bucket Tag
  'contestTag',        // Contest Tag
  'sourceTag',         // Source Tag
  'authorTypeTag',     // Author Type Tag
  'preContractedTag',  // Pre-Contract Validation
  'preContractCompany' // Pre-Contract Company
];

const ROLLUP_FIELDS = new Set([
  'booksCreated',
  'booksChp1Published',
  'books10kCompleted',
  'booksModPassed',
  'booksExpressContracted',
  'booksWBPContracted',
  'booksOFW',
  'firstContractDate',
  'firstContractBookId',
  'first300kWordDate',
  'first300kWordBookId'
]);

module.exports = { SPECIAL_FIELDS, ROLLUP_FIELDS };
