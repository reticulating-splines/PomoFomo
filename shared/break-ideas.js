// Break ideas shown on the timer tab during breaks. Every idea gets the kid
// away from the screen. `long: true` ideas only appear on long breaks.
// `icon` is a symbol id in assets/sprite.svg.

export const BREAK_IDEAS = [
  { id: 'stretch', icon: 'idea-stretch', title: 'Stretch',             text: 'Reach up as high as you can, then touch your toes. Three times.' },
  { id: 'water',   icon: 'idea-water',   title: 'Get some water',      text: 'Go fill a glass. Drink it.' },
  { id: 'far',     icon: 'idea-far',     title: 'Look far away',       text: 'Find the farthest thing you can see out a window and look at it for a bit. Your eyes need the change.' },
  { id: 'dance',   icon: 'idea-dance',   title: 'Put on a song',       text: 'Something loud. Dancing optional, but recommended.' },
  { id: 'jump',    icon: 'idea-jump',    title: '10 jumping jacks',    text: 'Then ten more, if you’re feeling ambitious.' },
  { id: 'breathe', icon: 'idea-breathe', title: 'Five slow breaths',   text: 'In through your nose, out through your mouth. Slower than you think.' },
  { id: 'wiggle',  icon: 'idea-wiggle',  title: 'Shake it out',        text: 'Hands, arms, shoulders, legs. Looks silly. Works anyway.' },
  { id: 'hello',   icon: 'idea-hello',   title: 'Go talk to someone',  text: 'Find someone at home and tell them something. Anything.' },
  { id: 'walk',    icon: 'idea-walk',    title: 'Walk around',         text: 'Do a lap of the house. Count the blue things you pass.' },
  { id: 'outside', icon: 'idea-outside', title: 'Go outside',          text: 'Fresh air. Look at the sky. It’s still there.', long: true },
  { id: 'snack',   icon: 'idea-snack',   title: 'Get a snack',         text: 'Preferably not sweets. Fruit, crackers, nuts.', long: true },
];

// Each buddy's signature idea, offered first on every other break
export const BUDDY_IDEAS = {
  dragon: { id: 'dragon-breath', icon: 'idea-dragon', title: 'Dragon breaths',          text: 'Breathe in slowly, then blow it all out like you’re lighting something. Five times.' },
  book:   { id: 'read',          icon: 'idea-read',   title: 'Read something on paper', text: 'A book, a comic, the back of a cereal box. Anything that isn’t a screen.' },
  wizard: { id: 'spell',         icon: 'idea-spell',  title: 'Stretching spell',        text: 'Fingers spread, arms up, as big as you can go. Hold it for ten.' },
  otho:   { id: 'spoons',        icon: 'idea-spoons', title: 'Count the spoons',        text: 'Check the kitchen drawer. Are they all there? Are you sure?' },
};

/**
 * Ideas for this kind of break, rotated by a seed (the log length) so each
 * break starts on a different idea but stays stable across re-renders and
 * reloads. The buddy's signature idea leads on every other break.
 */
export function ideasFor({ isLong, seed, buddy }) {
  const signature = BUDDY_IDEAS[buddy];
  const general = BREAK_IDEAS.filter(i => !i.long);
  // The log grows by two per round (focus + break), so count in rounds
  const round = Math.abs(Math.floor(seed / 2));
  const offset = round % general.length;
  const rotated = [...general.slice(offset), ...general.slice(0, offset)];
  // Long breaks lead with the long-break ideas
  const lead = isLong ? BREAK_IDEAS.filter(i => i.long) : [];
  const withBuddy = signature
    ? (round % 2 === 0 ? [signature, ...rotated] : [rotated[0], signature, ...rotated.slice(1)])
    : rotated;
  return [...lead, ...withBuddy];
}
