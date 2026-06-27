/**
 * Bundled, SFW prompt banks. In-repo data (no external API). Each category is a
 * flat list; `getBankLength` + `renderPrompt` are the only bank accessors the
 * service needs, so adding content never touches the logic.
 */

export type PromptCategory = 'qotd' | 'wyr' | 'truth' | 'dare' | 'nhie' | 'mostlikely';
export const PROMPT_CATEGORIES: readonly PromptCategory[] = [
  'qotd',
  'wyr',
  'truth',
  'dare',
  'nhie',
  'mostlikely',
];

export const CATEGORY_TITLE: Record<PromptCategory, string> = {
  qotd: '❓ Question of the Day',
  wyr: '🤔 Would You Rather',
  truth: '🎭 Truth',
  dare: '🔥 Dare',
  nhie: '🙅 Never Have I Ever',
  mostlikely: '👀 Most Likely To…',
};

export const QOTD: readonly string[] = [
  'What is a small thing that instantly improves your day?',
  'If you could master one skill overnight, what would it be?',
  'What is the best piece of advice you have ever received?',
  'What fictional world would you most want to live in?',
  'What is a hobby you would pick up with unlimited free time?',
  'What song could you listen to on repeat forever?',
  'What is the most underrated food?',
  'If you could have dinner with anyone, living or dead, who?',
  'What is a movie you can rewatch endlessly?',
  'What is your go-to comfort meal?',
  'What is something you changed your mind about recently?',
  'What is the best trip you have ever taken?',
  'What is a skill you think everyone should learn?',
  'What is your favorite way to relax after a long day?',
  'What is the most interesting thing you learned this week?',
  'If money were no object, what would you do all day?',
  'What is a book or show that changed how you think?',
  'What is your favorite season, and why?',
  'What is something you are looking forward to?',
  'What is the best gift you have ever given someone?',
  'What is a tiny luxury that feels worth it to you?',
  'What is your most-used app, and why?',
  'What is a goal you are working toward right now?',
  'What is the funniest thing that happened to you recently?',
  'What is a place you would love to visit someday?',
];

export const WYR: readonly [string, string][] = [
  ['have the ability to fly', 'be able to turn invisible'],
  ['always be 10 minutes late', 'always be 20 minutes early'],
  ['live without music', 'live without movies'],
  ['have unlimited coffee', 'have unlimited free time'],
  ['be able to talk to animals', 'speak every human language'],
  ['only travel by foot', 'never be allowed to walk again (always ride)'],
  ['have a rewind button', 'have a pause button for your life'],
  ['be the funniest person in the room', 'be the smartest person in the room'],
  ['never have to sleep', 'never have to eat'],
  ['explore space', 'explore the deep ocean'],
  ['have free flights for life', 'have free food for life'],
  ['be able to teleport', 'be able to time travel'],
  ['always know when someone is lying', 'always get away with lying'],
  ['live in a big city', 'live in a quiet countryside'],
  ['have a personal chef', 'have a personal driver'],
  ['read minds', 'see one day into the future'],
  ['win the lottery', 'live twice as long'],
  ['give up the internet for a month', 'give up your favorite food for a year'],
  ['be a famous actor', 'be a famous musician'],
  ['have super strength', 'have super speed'],
];

export const TRUTH: readonly string[] = [
  'What is the most embarrassing song on your playlist?',
  'What is a small lie you tell often?',
  'What is your biggest irrational fear?',
  'What is the last thing you searched on your phone?',
  'What is a guilty-pleasure show you secretly love?',
  'What is something you are weirdly competitive about?',
  'What is the worst fashion choice you ever made?',
  'What is your most-used emoji?',
  'What is a talent you have that few people know about?',
  'What is the strangest food combination you enjoy?',
  'What is a habit you wish you could break?',
  'What is the most childish thing you still do?',
  'What is something you pretend to understand but do not?',
  'What is the longest you have gone without sleep?',
  'What is your most controversial food opinion?',
];

export const DARE: readonly string[] = [
  'Send the 5th photo in your camera roll (keep it SFW).',
  'Type your next message using only emojis.',
  'Change your nickname to whatever the channel suggests for 10 minutes.',
  'Speak in rhymes for your next three messages.',
  'Share an unpopular opinion you actually hold.',
  'Do your best impression of another member (kindly).',
  'Write a one-line poem about the last thing you ate.',
  'Use no vowels in your next message.',
  'Compliment three people in the channel.',
  'Share the most recent meme you saved.',
  'Narrate your next 10 minutes like a sports commentator.',
  'Recommend a song everyone should hear right now.',
  'Tell a joke — if no one laughs, tell another.',
  'Describe your day using only movie titles.',
  'Give the channel a fun fact you know by heart.',
];

export const NHIE: readonly string[] = [
  'Never have I ever fallen asleep in a meeting or class.',
  'Never have I ever binged an entire series in one day.',
  'Never have I ever sent a text to the wrong person.',
  'Never have I ever forgotten someone’s name right after meeting them.',
  'Never have I ever pretended to be busy to avoid plans.',
  'Never have I ever laughed at the wrong moment.',
  'Never have I ever gotten lost using GPS.',
  'Never have I ever stayed up all night gaming.',
  'Never have I ever talked to a pet like it understands me.',
  'Never have I ever re-read a message I sent 10 times.',
  'Never have I ever sung in the shower at full volume.',
  'Never have I ever forgotten why I walked into a room.',
  'Never have I ever rage-quit a game.',
  'Never have I ever eaten dessert before dinner.',
  'Never have I ever pretended to know a song I did not.',
];

export const MOSTLIKELY: readonly string[] = [
  'become internet famous',
  'survive a zombie apocalypse',
  'forget their own birthday',
  'start a successful business',
  'travel the entire world',
  'adopt ten pets',
  'win an award for something random',
  'become a professional gamer',
  'show up late to their own party',
  'cry at a happy movie',
  'know a fact about literally anything',
  'fall asleep first at a sleepover',
  'turn a hobby into a career',
  'get lost in their own city',
  'write a best-selling book',
];

function bank(category: PromptCategory): readonly unknown[] {
  switch (category) {
    case 'qotd':
      return QOTD;
    case 'wyr':
      return WYR;
    case 'truth':
      return TRUTH;
    case 'dare':
      return DARE;
    case 'nhie':
      return NHIE;
    case 'mostlikely':
      return MOSTLIKELY;
  }
}

export function getBankLength(category: PromptCategory): number {
  return bank(category).length;
}

/** Render the prompt body at `index` for a category (index assumed in range). */
export function renderPrompt(category: PromptCategory, index: number): string {
  if (category === 'wyr') {
    const pair = WYR[index] ?? WYR[0]!;
    return `🅰️ Would you rather **${pair[0]}**\n\n— or —\n\n🅱️ **${pair[1]}**?`;
  }
  if (category === 'mostlikely') {
    return `Who is most likely to **${MOSTLIKELY[index] ?? MOSTLIKELY[0]!}**?`;
  }
  const list = bank(category) as readonly string[];
  return list[index] ?? list[0]!;
}
