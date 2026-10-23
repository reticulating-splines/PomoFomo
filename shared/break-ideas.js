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

/**
 * Ideas for this kind of break, rotated by a seed so each break starts on a
 * different idea but stays stable across re-renders and reloads.
 */
export function ideasFor({ isLong, seed }) {
  const pool = isLong
    ? [...BREAK_IDEAS.filter(i => i.long), ...BREAK_IDEAS.filter(i => !i.long)]
    : BREAK_IDEAS.filter(i => !i.long);
  if (isLong) return pool; // long breaks lead with the long-break ideas
  const offset = Math.abs(Math.floor(seed / 1000)) % pool.length;
  return [...pool.slice(offset), ...pool.slice(0, offset)];
}
