import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

import { createGame, getGame } from "./gameManager";

const app = express();
app.use(cors());
app.use(express.json());

// Endpoint: crear partida
app.post("/create", (req, res) => {
  const game = createGame();
  res.json(game);
});

// Endpoint: obtener estado
app.get("/game/:id", (req, res) => {
  const game = getGame(req.params.id);
  if (!game) return res.status(404).json({ error: "Not found" });
  res.json(game);
});

// WebSocket
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*"
  }
});

io.on("connection", (socket) => {
  console.log("Player connected");

  socket.on("joinGame", (gameId) => {
    socket.join(gameId);
    io.to(gameId).emit("playerJoined");
  });

  socket.on("playMove", ({ gameId, move }) => {
    io.to(gameId).emit("movePlayed", move);
  });
});

const port = process.env.PORT || 3000;
httpServer.listen(port, () => {
  console.log("Backend running on port", port);
});
