// src/index.ts (extract)
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

import { createGameWithId, addPlayerToGame, getGame, resetAnswersForTurn } from "./gameManager";
import { fetchCityData } from "./openaiHelper";
import { computeScoreForPair } from "./scoring";

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
    // check if both answered
    const answers = Object.values(g.players).map(pl => pl.lastAnswer);
    if (answers.every(a => !!a) || Object.values(g.players).length < 2) {
      // stop timer and evaluate immediately
      if (g.turnTimer) {
        clearTimeout(g.turnTimer);
        g.turnTimer = null;
      }
      await evaluateTurn(gameId);
    } else {
      // wait for other
    }
  });

  socket.on("disconnect", () => {
    console.log("disconnect", socket.id);
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


  // pick a city (random)
  const city = SOURCE_CITIES[Math.floor(Math.random() * SOURCE_CITIES.length)];
  g.turnCity = city;
  g.turnStartTime = Date.now();
  resetAnswersForTurn(g);

  console.log(`[startNextTurn] Ciudad base = ${city}`);


  io.to(gameId).emit("newTurn", { turnIndex: g.currentTurnIndex, sourceCity: city, seconds: 20 });

  // set timer 20s
  g.turnTimer = setTimeout(async () => {
    console.log(`[turnTimeout] Tiempo agotado en turno ${g.currentTurnIndex} → evaluando`);

    g.turnTimer = null;
    await evaluateTurn(gameId);
  }, 20_000);
}

// Evaluate turn: fetch city data for source and both answers, score, emit result
async function evaluateTurn(gameId: string) {
  const g = getGame(gameId);
  if (!g) return;

  console.log(`[evaluateTurn] Evaluando turno ${g.currentTurnIndex} gameId=${gameId}`);


  const sourceCity = g.turnCity!;
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
    try {
      answerInfo = await fetchCityData(answer);
    } catch (err) { console.error("openai answer fetch", err); answerInfo = {}; }

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

  

  // prepare next turn
  g.currentTurnIndex += 1;
  // short delay between turns
  setTimeout(() => startNextTurn(gameId), 2500);
}

const port = process.env.PORT || 3000;
httpServer.listen(port, () => {
  console.log("Backend running on port", port);
});
