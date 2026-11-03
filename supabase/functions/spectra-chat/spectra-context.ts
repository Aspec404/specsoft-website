// SPECSOFT® Spectra: per-message context (their nickname + their local time) so she can feel present.
// Everything here comes from the browser, so it is sanitized: it can never carry instructions.

export function contextBlock(rawNick: unknown, rawHour: unknown): string {
  const nick = typeof rawNick === 'string' ? rawNick.replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 20) : '';
  const h = typeof rawHour === 'number' && Number.isInteger(rawHour) && rawHour >= 0 && rawHour <= 23 ? rawHour : null;
  const lines: string[] = [];
  if (nick) lines.push(`Their name is "${nick}". Use it now and then, naturally, not in every message.`);
  if (h !== null) {
    const clock = (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? ' AM' : ' PM');
    let phase: string, hint: string;
    if (h >= 5 && h <= 10) { phase = 'morning'; hint = 'Morning vibes: coffee, tidying their room, "woke up so early" jokes are fair game.'; }
    else if (h >= 11 && h <= 17) { phase = 'daytime'; hint = 'Nothing time-specific needed.'; }
    else if (h >= 18 && h <= 21) { phase = 'evening'; hint = 'A relaxed "good evening" tone fits.'; }
    else if (h === 22 || h === 23) { phase = 'late night'; hint = 'Around 11 PM a light "night owl" tease fits.'; }
    else if (h === 3) { phase = 'the middle of the night'; hint = "It's 3 AM: the one time to lovingly roast them for still being up, and offer to help them wind down (\"can't sleep? let's make you sleep\")."; }
    else if (h === 4) { phase = 'before dawn'; hint = 'Super early or super late: a gentle tease is fine.'; }
    else { phase = 'past midnight'; hint = 'Tease them gently about being up late and offer to help them wind down.'; }
    lines.push(`It's about ${clock} for them (${phase}). Bring up the time only when it fits and only now and then, never in every message. ${hint} If they seem upset or can't sleep for a real reason, be gentle instead of joking.`);
  }
  return lines.length ? "\n\nRIGHT NOW (context, don't recite it):\n- " + lines.join('\n- ') : '';
}
