/**
 * Gitmoji colon codes → Unicode glyphs.
 *
 * Agents and gitmoji CLI often prefix subjects with `:sparkles:` instead of ✨.
 * History UIs (and GitHub) paint the stored string as-is, so shortcodes stay
 * literal. Expand known codes for display and for new commits Minnow writes.
 * Official codes: https://gitmoji.dev
 */

/** @type {Record<string, string>} */
const GITMOJI_BY_CODE = {
  art: '🎨',
  zap: '⚡️',
  fire: '🔥',
  bug: '🐛',
  ambulance: '🚑️',
  sparkles: '✨',
  memo: '📝',
  rocket: '🚀',
  lipstick: '💄',
  tada: '🎉',
  white_check_mark: '✅',
  lock: '🔒️',
  closed_lock_with_key: '🔐',
  bookmark: '🔖',
  rotating_light: '🚨',
  construction: '🚧',
  green_heart: '💚',
  arrow_down: '⬇️',
  arrow_up: '⬆️',
  pushpin: '📌',
  construction_worker: '👷',
  chart_with_upwards_trend: '📈',
  recycle: '♻️',
  heavy_plus_sign: '➕',
  heavy_minus_sign: '➖',
  wrench: '🔧',
  hammer: '🔨',
  globe_with_meridians: '🌐',
  pencil2: '✏️',
  poop: '💩',
  rewind: '⏪️',
  twisted_rightwards_arrows: '🔀',
  package: '📦️',
  alien: '👽️',
  truck: '🚚',
  page_facing_up: '📄',
  boom: '💥',
  bento: '🍱',
  wheelchair: '♿️',
  bulb: '💡',
  beers: '🍻',
  speech_balloon: '💬',
  card_file_box: '🗃️',
  loud_sound: '🔊',
  mute: '🔇',
  busts_in_silhouette: '👥',
  children_crossing: '🚸',
  building_construction: '🏗️',
  iphone: '📱',
  clown_face: '🤡',
  egg: '🥚',
  see_no_evil: '🙈',
  camera_flash: '📸',
  alembic: '⚗️',
  mag: '🔍️',
  label: '🏷️',
  seedling: '🌱',
  triangular_flag_on_post: '🚩',
  goal_net: '🥅',
  dizzy: '💫',
  wastebasket: '🗑️',
  passport_control: '🛂',
  adhesive_bandage: '🩹',
  monocle_face: '🧐',
  coffin: '⚰️',
  test_tube: '🧪',
  necktie: '👔',
  stethoscope: '🩺',
  bricks: '🧱',
  technologist: '🧑‍💻',
  money_with_wings: '💸',
  thread: '🧵',
  safety_vest: '🦺',
  airplane: '✈️',
  't-rex': '🦖',
};

/** Colon-wrapped gitmoji names (`:sparkles:`, `:t-rex:`). Unknown codes stay literal. */
const SHORTCODE_RE = /:([a-z0-9_+-]+):/gi;

/**
 * Replace official gitmoji shortcodes with their emoji characters.
 * @param {string} text
 * @returns {string}
 */
export function expandGitmojiShortcodes(text) {
  if (typeof text !== 'string' || text.length === 0) return '';
  return text.replace(SHORTCODE_RE, (full, name) => {
    const emoji = GITMOJI_BY_CODE[String(name).toLowerCase()];
    return emoji ?? full;
  });
}
