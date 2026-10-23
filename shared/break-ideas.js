// Break ideas shown on the timer tab during breaks. Every idea gets the kid
// away from the screen. `long: true` ideas only appear on long breaks.
// `icon` is a symbol id in assets/sprite.svg.

export const BREAK_IDEAS = [
  { id: 'stretch', icon: 'idea-stretch', title: 'Stretch up tall',     text: 'Reach for the sky, then touch your toes. Do it three times.' },
  { id: 'water',   icon: 'idea-water',   title: 'Drink some water',    text: 'Your brain loves water. Go fill up a glass!' },
  { id: 'far',     icon: 'idea-far',     title: 'Look far away',       text: 'Find the farthest thing you can see out a window. Rest your eyes on it.' },
  { id: 'dance',   icon: 'idea-dance',   title: 'Dance party!',        text: 'Put on a song you love and dance it out.' },
  { id: 'jump',    icon: 'idea-jump',    title: '10 jumping jacks',    text: 'Count them out loud. Can you do 10 more?' },
  { id: 'breathe', icon: 'idea-breathe', title: 'Five big breaths',    text: 'Smell the flower… blow out the candle. Slowly, five times.' },
  { id: 'wiggle',  icon: 'idea-wiggle',  title: 'Shake it out',        text: 'Wiggle your fingers, arms, shoulders and legs. Wiggle everything!' },
  { id: 'hello',   icon: 'idea-hello',   title: 'Say hi to someone',   text: 'Tell someone at home something funny or kind.' },
  { id: 'walk',    icon: 'idea-walk',    title: 'Take a little walk',  text: 'Walk around your home. Spot three things that are blue.' },
  { id: 'outside', icon: 'idea-outside', title: 'Step outside',        text: 'Get some fresh air and look up at the sky.', long: true },
  { id: 'snack',   icon: 'idea-snack',   title: 'Have a healthy snack', text: 'An apple, some crackers, a handful of nuts — fuel up!', long: true },
];

// Each buddy's signature idea, offered first on every other break
export const BUDDY_IDEAS = {
  dragon: { id: 'dragon-breath', icon: 'idea-dragon', title: 'Dragon breaths',        text: 'Breathe in slowly… then whoosh it out like dragon fire! Five times.' },
  book:   { id: 'read',          icon: 'idea-read',   title: 'Read something real',   text: 'Grab a paper book or comic and read a page or two away from the screen.' },
  wizard: { id: 'spell',         icon: 'idea-spell',  title: 'Cast a stretching spell', text: 'Wiggle your fingers like sparks, then reach up high and make the biggest fireball shape you can!' },
  otho:   { id: 'spoons',        icon: 'idea-spoons', title: 'Count the spoons',      text: 'Go and count the spoons in the kitchen drawer. Are they ALL still there? Hmm…' },
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
