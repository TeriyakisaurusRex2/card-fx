import type { CardDef } from './data';

// Keywords are the short rules words a card can lead with ("Swift.", "Ward — pay 1.").
// The classic layout prints them inside the rules sentence; the modern layout lifts them
// out into icon badges and leaves only the rest as body text.

export const KEYWORDS: Record<string, string> = {
  Swift: 'Can attack on the turn it enters play.',
  Breakthrough: 'Damage beyond what kills a blocker carries on to the enemy Sovereign.',
  Fatal: 'Any damage this deals to a unit destroys it.',
  Fleeting: 'Leaves play at the end of the turn.',
  Ward: 'An enemy must pay the listed price to target this.',
  Fast: 'Can be cast at any time, even in response.',
  Slow: 'Can only be cast on your own turn, outside combat.',
  Edict: "A Sovereign's standing law. It applies for as long as the Sovereign holds the throne.",
};

export interface Keyword {
  name: string;
  /** Extra detail printed on the card, like the price of a Ward. */
  note?: string;
}

/**
 * Splits a card's rules text into leading keywords and the remaining body.
 * "Swift. When this dies, deal 1." becomes keywords [Swift] and body "When this dies, deal 1."
 */
export function splitRules(def: CardDef): { keywords: Keyword[]; body: string } {
  const sentences = def.text.split(/(?<=\.)\s+/);
  const keywords: Keyword[] = [];
  let i = 0;
  for (; i < sentences.length; i++) {
    const s = sentences[i].replace(/\.$/, '');
    if (KEYWORDS[s]) {
      keywords.push({ name: s });
      continue;
    }
    const m = /^(\w+) — (.+)$/.exec(s);
    if (m && KEYWORDS[m[1]]) {
      if (m[1] === 'Edict') {
        // An Edict's law is the rest of the text, so it stays as the body.
        keywords.push({ name: 'Edict' });
        sentences[i] = sentences[i].slice('Edict — '.length);
        break;
      }
      keywords.push({ name: m[1], note: m[2] });
      continue;
    }
    break;
  }
  return { keywords, body: sentences.slice(i).join(' ') };
}

/** Draws a keyword's icon as simple strokes inside a circle of radius r centred on (x, y). */
export function drawKeywordIcon(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, r: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(r / 10, r / 10); // every icon below is drawn on a 20-unit grid
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (name) {
    case 'Swift': // double chevron
      ctx.moveTo(-6, -5); ctx.lineTo(-1, 0); ctx.lineTo(-6, 5);
      ctx.moveTo(1, -5); ctx.lineTo(6, 0); ctx.lineTo(1, 5);
      ctx.stroke();
      break;
    case 'Breakthrough': // arrow through a wall
      ctx.moveTo(-1, -7); ctx.lineTo(-1, -3); ctx.moveTo(-1, 3); ctx.lineTo(-1, 7);
      ctx.moveTo(-7, 0); ctx.lineTo(6, 0); ctx.moveTo(2, -4); ctx.lineTo(6, 0); ctx.lineTo(2, 4);
      ctx.stroke();
      break;
    case 'Fatal': // dagger
      ctx.moveTo(0, -8); ctx.lineTo(2.2, 1); ctx.lineTo(-2.2, 1); ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-5, 2); ctx.lineTo(5, 2); ctx.moveTo(0, 2); ctx.lineTo(0, 8);
      ctx.stroke();
      break;
    case 'Fleeting': // hourglass
      ctx.moveTo(-5, -7); ctx.lineTo(5, -7); ctx.lineTo(-5, 7); ctx.lineTo(5, 7); ctx.closePath();
      ctx.stroke();
      break;
    case 'Ward': // shield
      ctx.moveTo(0, -8); ctx.lineTo(6.5, -5); ctx.lineTo(6.5, 0);
      ctx.quadraticCurveTo(6, 6, 0, 8.5); ctx.quadraticCurveTo(-6, 6, -6.5, 0);
      ctx.lineTo(-6.5, -5); ctx.closePath();
      ctx.stroke();
      break;
    case 'Fast': // lightning bolt
      ctx.moveTo(2, -8); ctx.lineTo(-5, 1); ctx.lineTo(0, 1); ctx.lineTo(-2, 8); ctx.lineTo(5, -1); ctx.lineTo(0, -1); ctx.closePath();
      ctx.fill();
      break;
    case 'Slow': // clock
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.moveTo(0, -4); ctx.lineTo(0, 0); ctx.lineTo(3.5, 2);
      ctx.stroke();
      break;
    case 'Edict': // crown
      ctx.moveTo(-7, 5); ctx.lineTo(-7, -4); ctx.lineTo(-3.5, 0); ctx.lineTo(0, -6); ctx.lineTo(3.5, 0); ctx.lineTo(7, -4); ctx.lineTo(7, 5); ctx.closePath();
      ctx.stroke();
      break;
    default: // diamond
      ctx.moveTo(0, -7); ctx.lineTo(6, 0); ctx.lineTo(0, 7); ctx.lineTo(-6, 0); ctx.closePath();
      ctx.stroke();
  }
  ctx.restore();
}
