// src/index.ts (extract)
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

import { createGameWithId, addPlayerToGame, getGame, resetAnswersForTurn, games } from "./gameManager";
import { fetchCityData } from "./openaiHelper";
import { computeScoreForPair } from "./scoring";
import { GameState } from "./types";

const app = express();
app.use(cors());
app.use(express.json());

app.post("/create", (req, res) => {
  const game = createGameWithId();
  console.log("Nueva partida creada:", game.id);
  res.json({ id: game.id });
});

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  console.log("🔌 [CONNECTION] Nuevo cliente conectado:", socket.id);

  socket.on("createMatch", async ({ nickname }) => {
    console.log(`[createMatch] Creando nueva partida para ${nickname} (socket: ${socket.id})`);
    const g = createGameWithId();
    console.log(`[createMatch] Partida creada con ID: ${g.id}`);
    addPlayerToGame(g.id, { id: socket.id, name: nickname ?? "P1", score: 0 });
    socket.join(g.id);
    socket.emit("matchCreated", { gameId: g.id });
    console.log(`[createMatch] Jugador añadido y evento matchCreated enviado`);
  });

  socket.on("joinMatch", ({ gameId, nickname }) => {
    console.log(`[joinMatch] EVENTO RECIBIDO: gameId=${gameId}, nickname=${nickname}, socketId=${socket.id}`);

    const g = getGame(gameId);
    if (!g) {
      console.log(`[joinMatch] ERROR: Partida ${gameId} no existe`);
      return socket.emit("errorMsg", "Game not found");
    }

    console.log(`[joinMatch] Jugador conectado socket=${socket.id} nombre=${nickname} gameId=${gameId}`);
    console.log(`[joinMatch] Estado actual del juego: ${JSON.stringify({ status: g.status, players: Object.keys(g.players) })}`);

    // Evitar añadir dos veces
    if (!g.players[socket.id]) {
      console.log(`[joinMatch] Añadiendo jugador ${nickname} al juego ${gameId}`);
      addPlayerToGame(gameId, { id: socket.id, name: nickname ?? "Jugador", score: 0 });
    } else {
      console.log(`[joinMatch] Jugador ${nickname} ya estaba en el juego ${gameId}`);
    }

    socket.join(gameId);

    const currentPlayers = Object.keys(g.players);
    console.log(`[joinMatch] Jugadores actuales en ${gameId}: ${currentPlayers.length} (${currentPlayers.join(', ')})`);

    io.to(gameId).emit("playerJoined", {
      players: Object.values(g.players)
    });

    // Cuando haya 2 → empezar partida
    if (currentPlayers.length === 2 && g.status === "waiting") {
      console.log(`[matchStart] ✅ CONDICIÓN CUMPLIDA: Partida ${gameId} tiene 2 jugadores → iniciando partida...`);

      g.status = "playing"; // Ir directamente a playing
      console.log(`[matchStart] Estado cambiado a playing para ${gameId}`);

      console.log(`[matchStart] Enviando matchStart al room ${gameId} con ${io.sockets.adapter.rooms.get(gameId)?.size || 0} sockets conectados`);
      io.to(gameId).emit("matchStart", {
        message: "👥 Ambos jugadores conectados. ¡La partida comienza!"
      });
      console.log(`[matchStart] Evento matchStart enviado exitosamente`);

      // Start turn cycle immediately
      console.log(`[matchStart] Iniciando ciclo de turnos en ${gameId}`);
      console.log(`[matchStart] Llamando setTimeout con startTurnCycle...`);
      setTimeout(() => {
        console.log(`[setTimeout] Ejecutando startTurnCycle para ${gameId}`);
        startTurnCycle(gameId);
      }, 100); // Pequeño delay para asegurar sincronización
    } else {
      console.log(`[joinMatch] Condición NO cumplida: players=${currentPlayers.length}, status=${g.status}`);
    }
  });
  

  socket.on("submitAnswer", async ({ gameId, answer }) => {
    console.log(`[submitAnswer] Received answer from ${socket.id}: "${answer}" for game ${gameId}`);
    const g = getGame(gameId);
    if (!g) {
      console.log(`[submitAnswer] Game ${gameId} not found`);
      return;
    }
    const p = g.players[socket.id];
    if (!p) {
      console.log(`[submitAnswer] Player ${socket.id} not found in game ${gameId}`);
      return;
    }

    p.lastAnswer = (answer || "").trim();
    console.log(`[submitAnswer] Game status: ${g.status}, turnCity: "${g.turnCity}", evaluating: ${g.evaluating}`);

    // check if all connected players have answered (only if they have non-empty answers)
    const connectedPlayers = Object.values(g.players);
    const answers = connectedPlayers.map(pl => pl.lastAnswer);
    const allAnswered = answers.every(a => a && a.trim().length > 0);

    console.log(`[submitAnswer] Connected players: ${connectedPlayers.length}, answers: [${answers.map(a => `"${a}"`).join(', ')}], allAnswered: ${allAnswered}`);

    if (allAnswered) {
      // stop timer and evaluate immediately
      if (g.turnTimer) {
        clearTimeout(g.turnTimer);
        g.turnTimer = null;
      }
      // Only evaluate if we have a valid turn city configured
      if (g.turnCity) {
        console.log(`[submitAnswer] Evaluating turn for game ${gameId}`);
        await evaluateTurn(gameId);
      } else {
        console.log(`[submitAnswer] Skipping evaluation for game ${gameId} - turnCity not configured yet`);
      }
    } else {
      console.log(`[submitAnswer] Waiting for all players to answer`);
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
function startTurnCycle(gameId: string) {

  console.log(`[startTurnCycle] 1`);
  const g = getGame(gameId);

  console.log(`[startTurnCycle] 2`);
  if (!g) return;
  console.log(`[startTurnCycle] 3`);
  // Nota: Removida la verificación de status === "playing" porque
  // esta función se llama cuando el juego acaba de ser marcado como "playing"
  // pero aún necesita ser inicializado

  console.log(`[startTurnCycle] Iniciando partida gameId=${gameId}, status actual: ${g.status}`);

  g.status = "playing";
  g.currentTurnIndex = 0;
  g.history = [];

  console.log(`[startTurnCycle] Estado establecido: playing, currentTurnIndex=0, history=[]`);
  console.log(`[startTurnCycle] Llamando a startNextTurn para gameId=${gameId}`);
  startNextTurn(gameId);
}

const SOURCE_CITIES = [
  "Paris", "New York", "Tokyo", "Buenos Aires", "Cairo", "Sydney", "Moscow", "Barcelona", "Lisbon", "Berlin",
  "London", "Rome", "Amsterdam", "Vienna", "Prague", "Budapest", "Athens", "Istanbul", "Jerusalem", "Dubai",
  "Rio de Janeiro", "Mexico City", "Bogota", "Lima", "Santiago", "Toronto", "Vancouver", "Montreal", "Chicago", "Los Angeles",
  "San Francisco", "Miami", "Seattle", "Boston", "Beijing", "Shanghai", "Seoul", "Bangkok", "Singapore", "Mumbai",
  "Delhi", "Jakarta", "Manila", "Kuala Lumpur", "Hong Kong", "Taipei", "Cape Town", "Nairobi", "Lagos", "Casablanca",
  "Madrid" // Movido al final para que no sea el primero
];

async function startNextTurn(gameId: string) {
  console.log(`[startNextTurn] Función llamada para gameId=${gameId}`);
  const g = getGame(gameId);
  if (!g) {
    console.log(`[startNextTurn] ERROR: Game ${gameId} not found`);
    return;
  }

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

  console.log(`[startNextTurn] Turno ${g.currentTurnIndex + 1}/${g.turnsTotal} gameId=${gameId}, status=${g.status}`);

  // Reset evaluation flag for new turn
  g.evaluating = false;

  // pick a city (random) - simple and reliable selection
  const arrayLength = SOURCE_CITIES.length;
  const randomValue = Math.random();
  const randomIndex = Math.floor(randomValue * arrayLength);
  let city = SOURCE_CITIES[randomIndex];

  if (!city) {
    console.error(`[startNextTurn] ERROR: Ciudad undefined en índice ${randomIndex}, array length: ${arrayLength}`);
    // Fallback to a known city
    city = SOURCE_CITIES[0];
  }

  g.turnCity = city;
  g.turnStartTime = Date.now();
  resetAnswersForTurn(g);

  console.log(`[startNextTurn] Ciudad aleatoria: random=${randomValue.toFixed(3)}, índice=${randomIndex}/${arrayLength}, ciudad="${city}"`);

  // Send turn start with server timestamp for better sync
  const serverTime = Date.now();
  console.log(`[startNextTurn] Enviando newTurn para turno ${g.currentTurnIndex + 1}: ciudad="${city}", gameId=${gameId}`);

  console.log(`[startNextTurn] Enviando newTurn al room ${gameId} con ${io.sockets.adapter.rooms.get(gameId)?.size || 0} sockets conectados`);

  // Intentar enviar por room primero
  io.to(gameId).emit("newTurn", {
    turnIndex: g.currentTurnIndex,
    sourceCity: city,
    seconds: 20,
    serverTime: serverTime
  });

  // También enviar directamente a cada socket del juego como backup
  console.log(`[startNextTurn] Enviando newTurn directamente a ${Object.keys(g.players).length} sockets`);
  for (const playerId of Object.keys(g.players)) {
    const socket = io.sockets.sockets.get(playerId);
    if (socket) {
      console.log(`[startNextTurn] Enviando a socket ${playerId}`);
      socket.emit("newTurn", {
        turnIndex: g.currentTurnIndex,
        sourceCity: city,
        seconds: 20,
        serverTime: serverTime
      });
    } else {
      console.log(`[startNextTurn] Socket ${playerId} no encontrado`);
    }
  }

  console.log(`[startNextTurn] Evento newTurn enviado exitosamente para gameId=${gameId}`);
  console.log(`[startNextTurn] Estado final del juego:`, {
    status: g.status,
    currentTurnIndex: g.currentTurnIndex,
    turnCity: g.turnCity,
    playersCount: Object.keys(g.players).length
  });

  console.log(`[startNextTurn] Turno configurado completamente para gameId=${gameId}`);

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
  console.log(`[evaluateTurn] Turno completado. Avanzando a turno ${g.currentTurnIndex + 1}/${g.turnsTotal}, gameId=${gameId}`);

  // Usar setImmediate para asegurar que el siguiente turno se inicie correctamente
  setImmediate(() => {
    startNextTurn(gameId);
  });
}

const port = process.env.PORT || 3000;
httpServer.listen(port, () => {
  console.log("Backend running on port", port);
});
