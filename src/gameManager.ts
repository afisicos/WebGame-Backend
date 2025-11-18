import { GameState } from "./types";

const games: Record<string, GameState> = {};

export function createGame(): GameState {
  const id = Math.random().toString(36).substring(2, 8);
  const game: GameState = {
    id,
    players: [],
    turn: 0,
    moves: []
  };
  games[id] = game;
  return game;
}

export function getGame(id: string): GameState | null {
  return games[id] ?? null;
}
