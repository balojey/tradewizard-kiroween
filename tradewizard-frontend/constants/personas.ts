import {
  Crosshair,
  Crown,
  Radar,
  RefreshCw,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Presented persona catalogue for pickers (account default + per-market
 * activation). Mirrors `PERSONA_REGISTRY` in `infra/services/shared/`.
 */
export interface PersonaDef {
  id: string;
  icon: LucideIcon;
  name: string;
  riskLevel: 'aggressive' | 'moderate' | 'conservative';
  philosophy: string;
  stats: {
    frequency: string;
    positionSize: string;
    holdDuration: string;
  };
  iconBg: string;
  iconTone: string;
}

export const PERSONAS: PersonaDef[] = [
  {
    id: 'sniper',
    icon: Crosshair,
    name: 'The Sniper',
    riskLevel: 'aggressive',
    philosophy:
      'Patient assassin. Only strikes on high-conviction setups with edge >10%. Rare trades, large positions, decisive exits.',
    stats: { frequency: '1–2/week', positionSize: '40–60%', holdDuration: 'Days–weeks' },
    iconBg: 'bg-no/10',
    iconTone: 'text-no',
  },
  {
    id: 'scalper',
    icon: Zap,
    name: 'The Scalper',
    riskLevel: 'moderate',
    philosophy:
      'Speed demon. Exploits small edges rapidly with tight stops. High frequency, small positions, quick in-and-out.',
    stats: { frequency: 'Daily', positionSize: '10–25%', holdDuration: 'Hours–1 day' },
    iconBg: 'bg-warning/10',
    iconTone: 'text-warning',
  },
  {
    id: 'contrarian',
    icon: RefreshCw,
    name: 'The Contrarian',
    riskLevel: 'aggressive',
    philosophy:
      'Rebel thinker. Fades crowd consensus when agents detect overreaction. Bets against the herd with conviction.',
    stats: { frequency: '2–4/week', positionSize: '30–50%', holdDuration: 'Days' },
    iconBg: 'bg-ai/10',
    iconTone: 'text-ai',
  },
  {
    id: 'catalyst-hunter',
    icon: Radar,
    name: 'The Catalyst Hunter',
    riskLevel: 'moderate',
    philosophy:
      'Event detective. Positions before scheduled catalysts (debates, rulings, data releases). Time-sensitive, focused entries.',
    stats: { frequency: 'Event-driven', positionSize: '20–40%', holdDuration: 'Hours–days' },
    iconBg: 'bg-accent/10',
    iconTone: 'text-accent',
  },
  {
    id: 'hedge-architect',
    icon: Crown,
    name: 'The Hedge Architect',
    riskLevel: 'conservative',
    philosophy:
      'Chess master. Builds multi-position spreads to reduce directional risk. Methodical, balanced, capital-preserving.',
    stats: { frequency: '2–3/week', positionSize: '15–30%', holdDuration: 'Days–weeks' },
    iconBg: 'bg-yes/10',
    iconTone: 'text-yes',
  },
  {
    id: 'momentum-rider',
    icon: Waves,
    name: 'The Momentum Rider',
    riskLevel: 'aggressive',
    philosophy:
      'Wave surfer. Follows strong trends with pyramiding. Adds to winners, cuts losers fast, rides until momentum breaks.',
    stats: { frequency: '3–5/week', positionSize: '25–50%', holdDuration: 'Days' },
    iconBg: 'bg-warning/10',
    iconTone: 'text-warning',
  },
];

export const RISK_BADGE_TONE: Record<PersonaDef['riskLevel'], 'no' | 'warning' | 'yes'> = {
  aggressive: 'no',
  moderate: 'warning',
  conservative: 'yes',
};

export function getPersonaDef(personaId: string | null | undefined): PersonaDef | null {
  if (!personaId) return null;
  return PERSONAS.find((persona) => persona.id === personaId) ?? null;
}
