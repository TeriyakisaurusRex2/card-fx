// Sample content. A real game only has to produce CardDef objects like these;
// nothing below this file knows where they came from.

export type Faction = 'ember' | 'cairn' | 'veil';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface CardDef {
  id: string;
  name: string;
  faction: Faction;
  type: 'Unit' | 'Spell' | 'Sovereign';
  subtype?: string;
  cost: number;
  power?: number;
  toughness?: number;
  text: string;
  rarity: Rarity;
  /** Art filename without extension, under public/art. */
  art: string;
  /** classic = framed window + text box. fullart = art bleeds under everything. */
  layout: 'classic' | 'fullart';
  /** 0 = crop to the top of the art, 1 = crop to the bottom. */
  focusY?: number;
}

const u = (
  art: string, name: string, faction: Faction, cost: number, power: number, toughness: number,
  subtype: string, text: string, rarity: Rarity, focusY = 0.3,
): CardDef => ({ id: art, art, name, faction, type: 'Unit', subtype, cost, power, toughness, text, rarity, layout: 'classic', focusY });

const s = (
  art: string, name: string, faction: Faction, cost: number, text: string, rarity: Rarity, focusY = 0.4,
): CardDef => ({ id: art, art, name, faction, type: 'Spell', cost, text, rarity, layout: 'classic', focusY });

const sov = (
  art: string, name: string, faction: Faction, cost: number, power: number, toughness: number, text: string,
): CardDef => ({ id: art, art, name, faction, type: 'Sovereign', subtype: 'Throne', cost, power, toughness, text, rarity: 'legendary', layout: 'fullart' });

export const CARDS: CardDef[] = [
  sov('ember_sov_pyrarch', 'The Pyrarch', 'ember', 7, 7, 6, 'Edict — Your units have Swift. When The Pyrarch strikes, ignite every enemy lane.'),
  sov('ember_sov_kindler', 'Kindler of Ash', 'ember', 5, 4, 5, 'Edict — The first spell you cast each turn costs 1 less.'),
  sov('cairn_sov_greatwarden', 'The Greatwarden', 'cairn', 7, 6, 8, 'Edict — You may bank one more mana. Your units enter with +0/+2.'),
  sov('cairn_sov_lodestone', 'Lodestone Regent', 'cairn', 6, 5, 7, 'Edict — At the end of your turn, gain a Ley counter.'),
  sov('veil_sov_hollow_queen', 'The Hollow Queen', 'veil', 7, 6, 6, 'Edict — When an enemy unit dies, draw a card and lose 1 life.'),
  sov('veil_sov_nightwarden', 'Nightwarden', 'veil', 5, 4, 4, 'Edict — Your spells cost 1 less while you have no units in play.'),

  u('ember_molten_colossus', 'Molten Colossus', 'ember', 7, 8, 6, 'Giant', 'Breakthrough. When this enters, deal 2 to each enemy unit.', 'epic'),
  u('veil_umbral_colossus', 'Umbral Colossus', 'veil', 7, 6, 8, 'Giant', 'Ward — discard a card. Enemies in this lane get -2/-0.', 'epic'),
  u('cairn_moss_titan', 'Moss Titan', 'cairn', 6, 6, 7, 'Giant', 'When this enters, gain 2 banked mana.', 'epic'),
  u('veil_dread_phantom', 'Dread Phantom', 'veil', 5, 5, 3, 'Spirit', 'Can only be blocked by units with Ward.', 'epic'),
  s('veil_unmake', 'Unmake', 'veil', 5, 'Fast. Banish a unit. Its controller draws a card.', 'epic'),
  s('cairn_avalanche', 'Avalanche', 'cairn', 6, 'Slow. Deal 4 to each unit that has power 3 or less.', 'epic'),

  u('ember_forge_captain', 'Forge Captain', 'ember', 4, 3, 4, 'Soldier', 'Your other units get +1/+0.', 'rare'),
  u('ember_ash_wraith', 'Ash Wraith', 'ember', 3, 3, 2, 'Spirit', 'Swift. When this dies, deal 1 to the enemy Sovereign.', 'rare'),
  u('cairn_hollow_giant', 'Hollow Giant', 'cairn', 5, 4, 6, 'Giant', 'Costs 1 less for each unit you control.', 'rare'),
  u('cairn_deeproot_warden', 'Deeproot Warden', 'cairn', 3, 2, 4, 'Treefolk', 'Ward — pay 2. When this enters, gain 1 life.', 'rare'),
  u('veil_nightblade', 'Nightblade', 'veil', 3, 3, 1, 'Assassin', 'Fatal. Cannot be blocked while you have no cards in hand.', 'rare'),
  u('veil_hexer', 'Hexer', 'veil', 2, 1, 3, 'Witch', 'When you cast a spell, give an enemy unit -1/-0.', 'rare'),
  s('ember_scorch', 'Scorch', 'ember', 2, 'Fast. Deal 3 to a unit.', 'rare'),
  s('veil_silence', 'Silence', 'veil', 3, 'Fast. Counter a spell unless its controller pays 2.', 'rare'),

  u('ember_flame_reaver', 'Flame Reaver', 'ember', 2, 3, 1, 'Raider', 'Breakthrough.', 'common'),
  u('ember_pyre_hound', 'Pyre Hound', 'ember', 2, 2, 2, 'Beast', 'Swift.', 'common'),
  u('ember_torchbearer', 'Torchbearer', 'ember', 1, 1, 2, 'Soldier', 'When this enters, your next spell costs 1 less.', 'common'),
  u('ember_kindling_scout', 'Kindling Scout', 'ember', 1, 2, 1, 'Scout', 'Swift.', 'common'),
  s('ember_ignite', 'Ignite', 'ember', 1, 'Fast. Deal 1 to a unit. Draw a card if it dies.', 'common'),
  s('ember_battle_fury', 'Battle Fury', 'ember', 2, 'Fast. Give a unit +2/+0 and Swift until end of turn.', 'common'),
  u('cairn_quarry_golem', 'Quarry Golem', 'cairn', 3, 2, 5, 'Golem', 'Cannot attack alone.', 'common'),
  u('cairn_grove_keeper', 'Grove Keeper', 'cairn', 2, 1, 3, 'Druid', 'When this enters, gain 1 banked mana.', 'common'),
  u('cairn_stone_acolyte', 'Stone Acolyte', 'cairn', 1, 1, 2, 'Cleric', 'Ward — pay 1.', 'common'),
  s('cairn_attunement', 'Attunement', 'cairn', 2, 'Slow. Gain 2 max mana this turn.', 'common'),
  u('veil_veiled_seer', 'Veiled Seer', 'veil', 2, 1, 2, 'Oracle', 'When this enters, look at the top card of your deck.', 'common'),
  u('veil_mistwalker', 'Mistwalker', 'veil', 2, 2, 2, 'Spirit', 'Fleeting. Cannot be blocked by units with power 3 or more.', 'common'),
  u('veil_shade_acolyte', 'Shade Acolyte', 'veil', 1, 1, 1, 'Cleric', 'Fleeting. When this dies, draw a card.', 'common'),
  u('veil_warded_sentry', 'Warded Sentry', 'veil', 2, 1, 3, 'Soldier', 'Ward — pay 1.', 'common'),
  u('veil_soul_siphoner', 'Soul Siphoner', 'veil', 3, 2, 3, 'Witch', 'When an enemy unit dies, gain 1 life.', 'common'),
  u('cairn_bulwark_sentinel', 'Bulwark Sentinel', 'cairn', 3, 1, 5, 'Golem', 'Enemies must attack this lane if able.', 'rare'),
];

export const byId = (id: string) => CARDS.find((c) => c.id === id)!;
export const ofRarity = (r: Rarity, f?: Faction) => CARDS.filter((c) => c.rarity === r && (!f || c.faction === f));

export const RARITY_COLOR: Record<Rarity, number> = {
  common: 0xb9b2a4,
  rare: 0x5fa8ff,
  epic: 0xb878ff,
  legendary: 0xffc65a,
};

export const FACTION_COLOR: Record<Faction, number> = {
  ember: 0xff7a45,
  cairn: 0xa8d478,
  veil: 0xa894e8,
};
