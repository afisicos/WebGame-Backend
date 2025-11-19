// src/index.ts (extract)
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

import { createGameWithId, addPlayerToGame, getGame, resetAnswersForTurn, games } from "./gameManager";
import { fetchCityData } from "./openaiHelper";
import { computeScoreForPair } from "./scoring";
import { GameState } from "./types";

const FRONTEND_URL = "https://webgame-frontend.vercel.app";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/create", (req, res) => {
  const game = createGameWithId();
  console.log("Nueva partida creada:", game.id);

  // Generate game URL and WhatsApp share link
  const gameUrl = `${FRONTEND_URL}/join/${game.id}`;
  const whatsappMessage = `¡Únete a mi partida de Cities Game! ${gameUrl}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(whatsappMessage)}`;

  res.json({
    id: game.id,
    gameUrl: gameUrl,
    whatsappUrl: whatsappUrl
  });
});

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  console.log("conn", socket.id);

  socket.on("createMatch", async ({ nickname }) => {
    const g = createGameWithId();
    addPlayerToGame(g.id, { id: socket.id, name: nickname ?? "P1", score: 0 });
    socket.join(g.id);
    socket.emit("matchCreated", { gameId: g.id });
  });

  socket.on("joinMatch", ({ gameId, nickname }) => {
    const g = getGame(gameId);
    if (!g) {
      console.log(`[joinMatch] Partida ${gameId} no existe`);
      return socket.emit("errorMsg", "Game not found");
    }
  
    console.log(`[joinMatch] Jugador conectado socket=${socket.id} nombre=${nickname} gameId=${gameId}`);
  
    // Evitar añadir dos veces
    if (!g.players[socket.id]) {
      addPlayerToGame(gameId, { id: socket.id, name: nickname ?? "Jugador", score: 0 });
    }
  
    socket.join(gameId);
  
    console.log(`[joinMatch] Jugadores actuales en ${gameId}: ${Object.keys(g.players).length}`);
  
    io.to(gameId).emit("playerJoined", {
      players: Object.values(g.players)
    });
  
    // Cuando haya 2 → empezar partida
    if (Object.keys(g.players).length === 2 && g.status === "waiting") {
      console.log(`[matchStart] Partida ${gameId} tiene 2 jugadores → iniciando partida...`);
  
      g.status = "starting";
  
      io.to(gameId).emit("matchStart", {
        message: "👥 Ambos jugadores conectados. ¡La partida comienza!"
      });
  
      setTimeout(() => {
        if (g.status === "starting") {
          g.status = "playing";
          console.log(`[matchStart] Iniciando ciclo de turnos en ${gameId}`);
          startTurnCycle(gameId);
        }
      }, 300);
    }
  });
  

  socket.on("submitAnswer", async ({ gameId, answer }) => {
    const g = getGame(gameId);
    if (!g) return;
    const p = g.players[socket.id];
    if (!p) return;
    p.lastAnswer = (answer || "").trim();
    // check if all connected players have answered, or if there's only 1 player left
    const connectedPlayers = Object.values(g.players);
    const answers = connectedPlayers.map(pl => pl.lastAnswer);
    const allAnswered = answers.every(a => !!a);

    if (allAnswered || connectedPlayers.length < 2) {
      // stop timer and evaluate immediately
      if (g.turnTimer) {
        clearTimeout(g.turnTimer);
        g.turnTimer = null;
      }
      // Only evaluate if we have a valid turn city configured
      if (g.turnCity) {
        await evaluateTurn(gameId);
      } else {
        console.log(`[submitAnswer] Skipping evaluation for game ${gameId} - turnCity not configured yet`);
      }
    } else {
      // wait for other players to answer
    }
  });

  socket.on("disconnect", () => {
    console.log("disconnect", socket.id);

    // Find and clean up any games this player was in
    for (const [gameId, game] of Object.entries(games) as [string, GameState][]) {
      if (game.players[socket.id]) {
        console.log(`[disconnect] Jugador ${socket.id} desconectado de partida ${gameId}`);

        // Remove player from game
        delete game.players[socket.id];
        game.playerOrder = game.playerOrder.filter(id => id !== socket.id);

        // If game was active and now has 0 players, clean it up
        if (Object.keys(game.players).length === 0) {
          console.log(`[disconnect] Partida ${gameId} vacía, eliminando...`);
          delete games[gameId];
        }
        // If game has 1 player left and was playing, continue normally
        // The remaining player can keep playing and the turn will timeout normally
      }
    }
  });
});

// Helper: start a turn cycle
async function startTurnCycle(gameId: string) {
  const g = getGame(gameId);
  if (!g) return;

  // Si ya está jugando, NO reiniciar
  if (g.status === "playing") return;

  console.log(`[startTurnCycle] Iniciando partida gameId=${gameId}`);

  g.status = "playing";
  g.currentTurnIndex = 0;
  g.history = [];

  await startNextTurn(gameId);
}

const SOURCE_CITIES = [
  "Madrid", "Paris", "New York", "Tokyo", "Buenos Aires", "Cairo", "Sydney", "Moscow", "Barcelona", "Lisbon", "Berlin",
  "London", "Rome", "Amsterdam", "Vienna", "Prague", "Budapest", "Athens", "Istanbul", "Jerusalem", "Dubai",
  "Rio de Janeiro", "Mexico City", "Bogota", "Lima", "Santiago", "Toronto", "Vancouver", "Montreal", "Chicago", "Los Angeles",
  "San Francisco", "Miami", "Seattle", "Boston", "Beijing", "Shanghai", "Seoul", "Bangkok", "Singapore", "Mumbai",
  "Delhi", "Jakarta", "Manila", "Kuala Lumpur", "Hong Kong", "Taipei", "Cape Town", "Nairobi", "Lagos", "Casablanca"
];

async function startNextTurn(gameId: string) {
  const g = getGame(gameId);
  if (!g) return;

  // Prevent starting new turn if already evaluating or if game is over
  if (g.evaluating || g.status === "finished") {
    console.log(`[startNextTurn] No se puede iniciar turno: evaluating=${g.evaluating}, status=${g.status}`);
    return;
  }

  if (g.turnTimer) {
    clearTimeout(g.turnTimer);
    g.turnTimer = null;
  }
  if (g.currentTurnIndex >= g.turnsTotal) {
    // game over
    g.status = "finished";
    io.to(gameId).emit("gameOver", {
      history: g.history,
      players: Object.values(g.players)
    });
    return;
  }

  console.log(`[startNextTurn] Turno ${g.currentTurnIndex + 1}/${g.turnsTotal} gameId=${gameId}`);

  // Reset evaluation flag for new turn
  g.evaluating = false;

  // pick a city (random)
  const city = SOURCE_CITIES[Math.floor(Math.random() * SOURCE_CITIES.length)];
  g.turnCity = city;
  g.turnStartTime = Date.now();
  resetAnswersForTurn(g);

  console.log(`[startNextTurn] Ciudad base seleccionada: ${city}, turnCity configurado: ${g.turnCity}`);

  // Send turn start with server timestamp for better sync
  const serverTime = Date.now();
  io.to(gameId).emit("newTurn", {
    turnIndex: g.currentTurnIndex,
    sourceCity: city,
    seconds: 20,
    serverTime: serverTime
  });

  // set timer 20s
  g.turnTimer = setTimeout(async () => {
    console.log(`[turnTimeout] Tiempo agotado en turno ${g.currentTurnIndex} → evaluando`);

    g.turnTimer = null;
    // Ensure turnCity is configured before evaluating
    if (g.turnCity) {
      await evaluateTurn(gameId);
    } else {
      console.error(`[turnTimeout] ERROR: turnCity not configured for timeout evaluation, game ${gameId}`);
    }
  }, 20_000);
}

// Evaluate turn: fetch city data for source and both answers, score, emit result
async function evaluateTurn(gameId: string) {
  const g = getGame(gameId);
  if (!g) return;

  // Prevent duplicate evaluations
  if (g.evaluating) {
    console.log(`[evaluateTurn] Turno ${g.currentTurnIndex} ya se está evaluando, saltando...`);
    return;
  }

  // Clear any existing timer to prevent race conditions
  if (g.turnTimer) {
    clearTimeout(g.turnTimer);
    g.turnTimer = null;
  }

  g.evaluating = true;
  console.log(`[evaluateTurn] Evaluando turno ${g.currentTurnIndex} gameId=${gameId}`);


  const sourceCity = g.turnCity;
  if (!sourceCity) {
    console.error(`[evaluateTurn] ERROR: turnCity is undefined for game ${gameId}, turn ${g.currentTurnIndex}`);
    // Skip this evaluation or try to recover
    g.evaluating = false;
    return;
  }

  let sourceInfo = null;
  try {
    sourceInfo = await fetchCityData(sourceCity);
  } catch (err) { console.error("openai source fetch", err); sourceInfo = {}; }

  const turnRecord: any = { sourceCity, results: {} as any };

  // for each player
  for (const pid of Object.keys(g.players)) {
    const p = g.players[pid];
    const answer = p.lastAnswer ?? ""; // could be empty if not answered
    let answerInfo = null;
    if (answer.trim()) {
      try {
        answerInfo = await fetchCityData(answer);
      } catch (err) { console.error("openai answer fetch", err); answerInfo = {}; }
    } else {
      // Empty answer - no need to call OpenAI
      answerInfo = { city: "", country: null, languages: [], population: null, foundedYear: null };
    }

    const res = await computeScoreForPair(sourceCity, answer, sourceInfo, answerInfo);
    p.score += res.points;
    turnRecord.results[pid] = {
      playerAnswer: answer,
      checks: res.checks,
      pointsGained: res.points,
      cityInfo: res.answerInfo,
      isEquivalentCity: res.isEquivalentCity,
      isInvalidCity: res.isInvalidCity
    };
  }

  g.history.push(turnRecord);

  console.log(`[evaluateTurn] Turno procesado. Resultados:`);


  // emit results
  io.to(gameId).emit("turnResult", {
    turnIndex: g.currentTurnIndex,
    record: turnRecord,
    players: Object.values(g.players).map(p => ({ id: p.id, name: p.name, score: p.score }))
  });

  // Mark evaluation as complete
  g.evaluating = false;

  // prepare next turn immediately
  g.currentTurnIndex += 1;
  startNextTurn(gameId);
}

const port = process.env.PORT || 3000;
httpServer.listen(port, () => {
  console.log("Backend running on port", port);
});
