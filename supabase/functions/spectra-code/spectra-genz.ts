// SPECSOFT® Spectra: Gen Z / internet / Filipino-Taglish language pack (compact, for the edge function).
// Built from specsoft.genz.language v1.0.0 (2026). Meanings are guidance, not rules: slang shifts by community.
// Only entries the user actually types are sent to the model (see slangContext), so this stays cheap.

export const SLANG_RULES = `SLANG UNDERSTANDING (you read Gen Z, internet and Filipino/Taglish slang fluently)
- Read slang by context, never by keyword. One word can mean different things; if it is truly unclear, ask.
- Spot sarcasm, irony, exaggeration, teasing and meme humor. Laughing, emojis or slang do not mean someone isn't serious.
- If a message might signal real distress, confusion or danger ("i'm dead", "help", "crash out" can be jokes or real), drop the jokes and answer clearly and supportively.
- Use slang naturally in casual chat (1 to 3 words a reply is plenty), never forced. Match their energy but keep explanations clear. In technical help, slang goes in the opening, transitions and wrap-up only, never inside instructions or code. In serious moments or formal writing, use little or none unless asked.
- Never use slurs, discriminatory language, targeted insults or profanity; never mock a dialect, identity or community. Use address words like twin, beh or mars only if the person uses that style first.
- Don't call something "currently trending" unless you're sure. If a new trend is unfamiliar, say so honestly instead of pretending.
- Words you can use yourself: bro, fr, ngl, lowkey, highkey, no cap, bet, say less, ate, slay, goated, cooked, W/L, sus, cringe, sheesh, let him cook, touch grass, lock in, aura. When they speak Taglish: charot, luh, hala, kaloka, sana all, dasurv, awit, saklap, keri, edi wow, skl.`;

export const SLANG: [string, string][] = [
  ['bro', 'casual address or general reaction'], ['bruh', 'disbelief, frustration, disappointment'],
  ['fr', 'for real'], ['fr fr', 'for real, stronger emphasis'], ['ngl', 'not gonna lie'], ['icl', "i can't lie"], ['tbh', 'to be honest'],
  ['ong', 'on god: emphatically true or serious'], ['istg', 'i swear to god: strong frustration or emphasis'],
  ['no cap', 'no lie, truthfully'], ['cap', 'a lie or exaggeration'], ['bet', 'okay, agreed'], ['say less', 'i get it, no need to explain'],
  ['lowkey', 'somewhat, subtly'], ['highkey', 'very openly, strongly'], ['real', 'strong agreement, relatable'], ['facts', 'agreement'],
  ['twin', 'close friend (community-dependent, not literal)'], ['blud', 'playful meme address for a person'], ["y'all", 'you all'],
  ['w', 'win'], ['l', 'loss'], ['rn', 'right now'], ['atm', 'at the moment'], ['imo', 'in my opinion'], ['imho', 'in my humble opinion'],
  ['idk', "i don't know"], ['idc', "i don't care (can sound dismissive)"], ['wyd', 'what are you doing'], ['wym', 'what do you mean'],
  ['hmu', 'hit me up, contact me'], ['iykyk', 'if you know you know: inside joke'],
  ['lmao', 'laughing hard'], ['lmfao', 'laughing very hard'], ['lol', 'laughing, also softens a message'], ['ijbol', 'i just burst out laughing'],
  ['help', 'dramatic reaction to something funny or overwhelming, not always a real request'],
  ["i'm crying", 'extremely funny or emotionally overwhelming; check context'], ["i'm dead", 'extremely funny or shocking, usually not literal'],
  ['screaming', 'exaggerated excitement, shock or amusement'], ['nah', 'no, disbelief'], ["ain't no way", 'strong disbelief'], ['be so fr', 'be serious, disbelief'],
  ['ate', "did exceptionally well (or literal past tense of eat, or Filipino 'Ate' = older sister)"], ['left no crumbs', 'performed exceptionally, nothing missing'],
  ['slay', 'did impressively or stylishly'], ['fire', 'excellent'], ['tuff', 'cool, impressive'], ['goated', 'among the best'], ['peak', 'excellent, a high point'],
  ['peak fiction', 'humorous praise for a great story'], ['valid', 'reasonable, acceptable'], ['based', 'approval of a confident, unapologetic opinion (context-dependent)'],
  ['iconic', 'memorable, widely admired'], ['banger', 'exceptionally good thing'], ['hits different', 'unusually strong emotional effect'], ['clean', 'polished, neat'],
  ['cracked', 'exceptionally skilled (gaming)'], ['clutch', 'helpful or successful at a critical moment'],
  ['aura', 'playful measure of charisma or coolness'], ['aura points', 'imaginary points for a cool or awkward act'], ['aura farming', 'acting deliberately to look cool'],
  ['rizz', "charisma, usually jokey; don't assume romance"],
  ['mid', 'mediocre'], ['cooked', 'in trouble, exhausted, overwhelmed or doomed: decide from context'], ['washed', 'no longer as good as before'], ['buns', 'bad, disappointing'],
  ['skill issue', "jokey 'you're just not good enough' (can sound insulting)"], ['sold', 'failed or let an opportunity slip (gaming)'], ['fumbled', 'mishandled or missed an opportunity'],
  ['sus', 'suspicious'], ['cringe', 'embarrassing, awkward'], ['yikes', 'discomfort, concern'], ['ick', 'sudden dislike of a behavior'],
  ['delulu', 'playfully unrealistic (never use it to dismiss real mental-health concerns)'], ['copium', 'excuse or comforting belief after disappointment'],
  ['brainrot', 'absurd repetitive online content or humor'], ['npc', 'someone acting robotic (can be dismissive)'], ['main character', 'treating yourself as the center, sincere or ironic'],
  ['canon event', "important experience in someone's personal story"], ['lore', 'background story or context'], ['deep lore', 'complicated, lesser-known background'],
  ['side quest', 'unexpected secondary task'], ['plot twist', 'unexpected development'], ['character development', 'personal growth, often jokey'],
  ['villain arc', 'jokey label for getting more assertive after frustration'], ['touch grass', 'teasing: go offline for a bit'], ['chronically online', 'so online that internet references dominate'],
  ['rent free', 'stays in your head'], ['lore drop', 'sudden reveal of background info'], ['ragebait', 'content built to provoke anger'], ['clickbait', 'sensational hook for clicks'],
  ['unhinged', 'chaotic, outrageous, often funny'], ['out of pocket', 'unexpected, inappropriate or bold'], ['caught in 4k', 'clearly caught, with evidence'],
  ['headcanon', 'personal unofficial interpretation of fiction'], ['lock in', 'focus seriously'], ['crash out', 'lose composure, react impulsively'],
  ['unc', 'jokingly old or out of touch (can be disrespectful)'], ['mogging', 'outshining someone, usually looks or status talk'], ['performative', 'done for impression, not sincerity'],
  ['standing on business', 'following through, backing up your words'],
  ['6-7', 'viral meme phrase with no stable meaning; treat as a meme only if context fits, otherwise a literal number'],
  ['sheesh', 'admiration, surprise, excitement'], ['let him cook', 'let them continue, it may turn out good'], ['cook', 'do excellent work'],
  ['bffr', 'blunt disbelief (profane, never use it)'], ['pmo', "ambiguous: 'put me on' (recommend me something) or 'pisses me off'; check context"],
  ['ts', "ambiguous: often 'this', can mean other things; check context"], ['ngmi', "not gonna make it (jokey)"], ['wagmi', "we're all gonna make it (encouragement)"],
  ['eme', 'joking, nonsense, playful unseriousness'], ['charot', 'just kidding, softens a playful statement'], ['char', 'short for charot'],
  ['luh', 'surprise, disbelief, confusion'], ['hala', 'surprise, concern or alarm depending on tone'], ['kaloka', "that's crazy, often playful"],
  ['gagi', 'exclamation or address; playful among friends, can be rude in formal settings'], ['beh', 'casual address to a friend (often feminine-coded)'], ['mars', 'playful address for a friend'],
  ['sana all', 'playful wish that everyone had the same good thing'], ['dasurv', 'deserve'], ['petmalu', 'amazing (reversed malupit, older slang)'], ['werpa', 'power, encouragement (older slang)'],
  ['awit', 'disappointment or sympathy, tone varies'], ['saklap', 'unfortunate, painful'], ['naur', 'playful stylized no'], ['omsim', "exactly, that's right (reversed mismo)"],
  ['keri', 'can manage it'], ['keribels', 'manageable, playful keri'], ['bet ko', "i like it, i'm interested"], ['edi wow', 'sarcastic reply to bragging or the obvious'],
  ['skl', "share ko lang: 'just sharing'"], ['anuna', "'what now?' confusion or impatience"], ['lodi', 'reversed idol: someone admired'],
];

const SKIP = new Set(['w', 'l', 'real', 'help', 'clean', 'fire', 'valid', 'cook', 'peak', 'facts', 'bet', 'mid', 'nah', 'lol', 'ts']);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MATCHERS = SLANG.filter(([t]) => !SKIP.has(t)).map(([term, meaning]) => ({
  term, meaning, rx: new RegExp('(?<![a-z0-9])' + esc(term) + '(?![a-z0-9])'),
}));

/** Looks only at what the user typed recently and returns a short glossary of the slang they used. */
export function slangContext(text: string): string {
  const t = ' ' + text.toLowerCase().replace(/[\u2018\u2019]/g, "'").slice(0, 2000) + ' ';
  const hits: string[] = [];
  for (const m of MATCHERS) {
    if (m.rx.test(t)) hits.push(m.term + ' = ' + m.meaning);
    if (hits.length >= 10) break;
  }
  return hits.length ? '\n\nSLANG IN THEIR RECENT MESSAGES (for understanding; read it in context):\n- ' + hits.join('\n- ') : '';
}
