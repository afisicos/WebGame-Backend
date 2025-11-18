// src/gameManager.ts
import { GameState, PlayerState } from "./types";

const games: Record<string, GameState> = {};

export function createGameWithId(id?: string): GameState {
  const gid = id ?? Math.random().toString(36).slice(2, 9);
  const g: GameState = {
    id: gid,
    players: {},
    playerOrder: [],
    currentTurnIndex: 0,
    turnsTotal: 5,
    history: [],
    turnTimer: null,
    status: "waiting"
  };
  games[gid] = g;
  return g;
}

export function getGame(id: string): GameState | null {
  return games[id] ?? null;
}

export function addPlayerToGame(gameId: string, player: PlayerState) {
  const g = getGame(gameId);
  if (!g) return null;
  g.players[player.id] = player;
  if (!g.playerOrder.includes(player.id)) g.playerOrder.push(player.id);
  return g;
}

export function resetAnswersForTurn(g: GameState) {
  for (const p of Object.values(g.players)) {
    p.lastAnswer = undefined;
  }
}
