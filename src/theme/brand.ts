/**
 * The Safe QLD marks and entity details.
 *
 * Deliberately free of any React Native import: printed documents are built as
 * HTML strings and the statutory forms are assembled off-screen, so both need
 * these values in contexts where there is no view layer at all.
 *
 * The colours were sampled from the letterhead artwork supplied by the office
 * (word/media/image1.jpeg inside the Word template), not matched by eye.
 */

export const brand = {
  /** The "SAFE" half of the wordmark, and the darker sweep of the Q shield. */
  red: '#9E1215',
  /** The "QLD" half of the wordmark. The primary brand colour. */
  orange: '#F1592A',
  /** The swoosh across the top and bottom of the page. */
  swoosh: '#F07110',
  /** "FIRE PROTECTION" under the wordmark. */
  charcoal: '#231F20',
  /** The letterhead stock. Not pure white. */
  paper: '#FAFAFA',
} as const;

/**
 * The registered entity, exactly as the letterhead states it.
 *
 * Anything that leaves the building carries these, so they are defined once.
 * The ABN is checksum-verified by the brand test.
 */
export const company = {
  legalName: 'SAFE QLD PTY LTD',
  tradingName: 'Safe QLD Fire Protection',
  abn: '51 130 129 270',
  address: 'U3, 61-63 Steel St, Capalaba QLD 4157',
  phone: '07 3286 6310',
  email: 'service@safeqld.com.au',
  web: 'www.safeqldfire.com.au',
} as const;
