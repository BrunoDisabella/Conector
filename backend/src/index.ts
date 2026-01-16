import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { ClientManager } from './ClientManager';
import apiRoutes from './routes/api';
import sessionRoutes from './routes/session';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Create HTTP Server & Socket.IO
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Direct connection strategy: Allow all
        methods: ["GET", "POST"]
    }
});

// Init Client Manager with IO instance
export const clientManager = new ClientManager(io);

// Routes
app.use('/api', apiRoutes);
app.use('/session', sessionRoutes);

app.get('/', (req, res) => {
    res.send('Conector Backend is running');
});

// Socket.IO Connection Handler
io.on('connection', (socket) => {
    console.log('New Socket Connection:', socket.id);

    // Client joins a room based on their user ID (secure way would be verifying token here too)
    socket.on('join_room', (userId) => {
        console.log(`Socket ${socket.id} joined room ${userId}`);
        socket.join(userId);
    });

    socket.on('disconnect', () => {
        console.log('Socket Disconnected:', socket.id);
    });
});

httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    clientManager.init();
});
