// src/types.ts (añade esto)
export type PlayerId = string;

export interface PlayerState {
  id: PlayerId;       // socket.id o un id propio
  name?: string;
  score: number;
  lastAnswer?: string;
}

export interface TurnResultDetail {
  playerAnswer: string;
  checks: {
    startsWith: boolean;   // a1
    endsWith: boolean;     // a2
    sameLength: boolean;   // b
    sameCountry: boolean;  // c
    sharedLanguage: boolean;// d
    populationSimilar: boolean; // e (2 puntos)
    foundedSameCentury: boolean; // f (3 puntos)
  };
  pointsGained: number;
  cityInfo?: any; // info returned by OpenAI for the answer city
  isEquivalentCity?: boolean; // true if answer city is equivalent to source city
  isInvalidCity?: boolean; // true if answer is not a valid city
}

export interface TurnRecord {
  sourceCity: string;
  results: Record<PlayerId, TurnResultDetail>;
}

export interface GameState {
  id: string;
  players: Record<PlayerId, PlayerState>;
  playerOrder: PlayerId[]; // two players order
  currentTurnIndex: number;
  turnsTotal: number; // 5
  history: TurnRecord[];
  turnTimer?: NodeJS.Timeout | null;
  turnStartTime?: number;
  turnCity?: string;
  status: "waiting" | "starting" | "playing" | "finished";
  evaluating?: boolean; // true if currently evaluating a turn
}
