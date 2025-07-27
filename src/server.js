const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const userRoutes = require('./routes/user.routes');
const messageRoutes = require('./routes/message.routes');
const { initTables } = require('./models/user.model');
const pool = require('./config/database');

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);

// Middleware
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'https://vasyaproger-socialbek-9493.twc1.net',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// Check for JWT_SECRET (optional for token-based auth)
if (!process.env.JWT_SECRET) {
  console.warn('Warning: JWT_SECRET not set in .env file. Token authentication disabled.');
}

// Initialize database tables
initTables().catch(err => {
  console.error('Error initializing tables:', err.stack);
  process.exit(1);
});

// Routes
app.use('/api', userRoutes);
app.use('/api', messageRoutes);

// Basic route
app.get('/', (req, res) => {
  res.send(`Hello, this is your Node.js backend on vasyaproger-socialbek-9493.twc1.net!`);
});

// WebSocket server
const wss = new WebSocket.Server({
  server,
  clientTracking: true,
  maxPayload: 10000,
  perMessageDeflate: false
});
const clients = new Map();
const pingIntervals = new Map();

// Cleanup client function
const cleanupClient = (clientId) => {
  const ws = clients.get(clientId);
  if (ws) {
    ws.terminate();
    clients.delete(clientId);
  }
  const interval = pingIntervals.get(clientId);
  if (interval) {
    clearInterval(interval);
    pingIntervals.delete(clientId);
  }
};

// Logging with timestamp
const logWithTimestamp = (message) => {
  const now = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty', hour12: false });
  console.log(`[${now}] ${message}`);
};

// Broadcast online status
function broadcastOnlineStatus(userId, isOnline) {
  clients.forEach((client, id) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'online_status',
        isOnline: isOnline,
        senderId: userId,
      }));
    }
  });
}

wss.on('connection', (ws, req) => {
  logWithTimestamp(`Received WebSocket request with URL: ${req.url}`);
  const url = new URL(req.url, `https://vasyaproger-socialbek-9493.twc1.net`);
  const token = url.searchParams.get('token');
  let userId = `anonymous-${Math.random().toString(36).slice(2)}`; // Default anonymous ID

  // Optional token verification
  if (token && process.env.JWT_SECRET) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { maxAge: '24h' });
      userId = decoded.id.toString();
      logWithTimestamp(`Authenticated user ${userId} connected via token`);
    } catch (error) {
      logWithTimestamp(`Invalid token provided: ${error.message}`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ success: false, message: 'Invalid token, proceeding as anonymous' }));
      }
    }
  } else {
    logWithTimestamp(`No token provided, connecting as ${userId}`);
  }

  // Handle duplicate connections
  if (clients.has(userId)) {
    logWithTimestamp(`Duplicate connection for ${userId}, closing old connection after 2s`);
    setTimeout(() => {
      if (clients.has(userId) && clients.get(userId) !== ws) {
        cleanupClient(userId);
        logWithTimestamp(`Old connection for ${userId} closed`);
      }
    }, 2000);
  }

  clients.set(userId, ws);
  logWithTimestamp(`${userId} connected to WebSocket`);

  // Broadcast online status
  broadcastOnlineStatus(userId, true);

  // Heartbeat mechanism
  ws.isAlive = true;
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
      logWithTimestamp(`Sent ping to ${userId}`);
    } else {
      logWithTimestamp(`Connection with ${userId} closed, cleaning up`);
      cleanupClient(userId);
    }
  }, 30000);
  pingIntervals.set(userId, pingInterval);

  ws.on('pong', () => {
    ws.isAlive = true;
    logWithTimestamp(`Received pong from ${userId}`);
  });

  ws.on('message', async (message) => {
    try {
      if (ws.readyState !== WebSocket.OPEN) return;

      if (Buffer.byteLength(message) > 10000) {
        ws.send(JSON.stringify({ success: false, message: 'Message too large' }));
        return;
      }

      const data = JSON.parse(message.toString());
      logWithTimestamp(`Received WebSocket message from ${userId}: ${JSON.stringify(data)}`);

      if (data.type === 'message') {
        const { senderId, receiverId, content, type } = data;
        // Handle message saving and forwarding (unchanged)
      } else if (data.type === 'offer' || data.type === 'answer' || data.type === 'ice_candidate') {
        const receiverWs = clients.get(data.receiverId?.toString());
        if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
          receiverWs.send(JSON.stringify(data));
          logWithTimestamp(`Forwarded WebRTC message (${data.type}) to ${data.receiverId}`);
        } else {
          ws.send(JSON.stringify({ type: 'offline', receiverId: data.receiverId }));
          logWithTimestamp(`Receiver ${data.receiverId} offline for WebRTC`);
        }
      } else if (data.type === 'online_status') {
        const receiverId = data.receiverId?.toString();
        const receiverWs = clients.get(receiverId);
        if (receiverWs && receiverWs.readyState === WebSocket.OPEN) {
          receiverWs.send(JSON.stringify({
            type: 'online_status',
            isOnline: true,
            senderId: receiverId,
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'online_status',
            isOnline: false,
            senderId: receiverId,
          }));
        }
      } else {
        ws.send(JSON.stringify({ success: false, message: 'Unknown message type' }));
      }
    } catch (error) {
      logWithTimestamp(`Error processing WebSocket message from ${userId}: ${error.message}`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ success: false, message: 'Error processing message' }));
      }
    }
  });

  ws.on('close', (code, reason) => {
    logWithTimestamp(`${userId} disconnected from WebSocket, code: ${code}, reason: ${reason.toString()}`);
    cleanupClient(userId);
    broadcastOnlineStatus(userId, false);
  });

  ws.on('error', (error) => {
    logWithTimestamp(`WebSocket error for ${userId}: ${error.message}`);
    cleanupClient(userId);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, 'Internal error');
    }
  });

  // Handle ping timeout
  const pingTimeout = setTimeout(() => {
    if (ws.isAlive === false) {
      logWithTimestamp(`Ping timeout for ${userId}, connection terminated`);
      cleanupClient(userId);
      ws.terminate();
    }
    ws.isAlive = false;
  }, 180000);
});

// Server error handling
server.on('error', (error) => {
  logWithTimestamp(`Server error: ${error.message}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logWithTimestamp('Received SIGTERM, shutting down...');
  wss.clients.forEach((client) => client.close());
  server.close(() => {
    logWithTimestamp('Server stopped');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logWithTimestamp('Received SIGINT, shutting down...');
  wss.clients.forEach((client) => client.close());
  server.close(() => {
    logWithTimestamp('Server stopped');
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  logWithTimestamp(`Server started on port ${PORT} for domain vasyaproger-socialbek-9493.twc1.net`);
});