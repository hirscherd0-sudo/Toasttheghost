const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Statische Dateien aus dem 'public' Ordner servieren
app.use(express.static(path.join(__dirname, 'public')));

// Routen
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Spiel-Zustand Speicher (im RAM)
const rooms = {};

io.on('connection', (socket) => {
    console.log('Ein Spieler hat sich verbunden:', socket.id);

    socket.on('joinRoom', ({ room, character, username }) => {
        socket.join(room);

        // Raum initialisieren falls nicht existent
        if (!rooms[room]) {
            rooms[room] = {
                players: {},
                ghosts: [], 
                pelletsRemoved: [], 
                crucifixesRemoved: [],
                hostId: socket.id, // Der erste Spieler ist Host
                level: 1
            };
        }

        // Spieler hinzufügen
        rooms[room].players[socket.id] = {
            id: socket.id,
            x: 0, 
            z: 0,
            rotation: 0,
            character: character, 
            username: username,
            isDead: false
        };

        // Dem Spieler den aktuellen State senden
        socket.emit('currentRoomState', rooms[room]);

        // Allen anderen sagen: "Neuer Spieler da"
        socket.to(room).emit('playerJoined', rooms[room].players[socket.id]);

        console.log(`${username} joined room ${room}`);
    });

    // Spieler bewegt sich
    socket.on('playerMove', ({ room, x, z, rotation }) => {
        if (rooms[room] && rooms[room].players[socket.id]) {
            const p = rooms[room].players[socket.id];
            p.x = x;
            p.z = z;
            p.rotation = rotation;
            // Position an alle anderen senden (außer an sich selbst)
            socket.to(room).emit('playerMoved', { id: socket.id, x, z, rotation });
        }
    });

    // Host sendet Geister-Updates
    socket.on('ghostsUpdate', ({ room, ghostsData }) => {
        if (rooms[room]) {
            rooms[room].ghosts = ghostsData;
            socket.to(room).emit('ghostsUpdated', ghostsData);
        }
    });

    // Ein Item wurde gesammelt 
    socket.on('itemCollected', ({ room, type, index }) => {
        if (!rooms[room]) return;
        
        if (type === 'pellet') {
            if (!rooms[room].pelletsRemoved.includes(index)) {
                rooms[room].pelletsRemoved.push(index);
                io.to(room).emit('itemRemoved', { type, index });
            }
        } else if (type === 'crucifix') {
             if (!rooms[room].crucifixesRemoved.includes(index)) {
                rooms[room].crucifixesRemoved.push(index);
                io.to(room).emit('itemRemoved', { type, index });
                // Power Mode für alle!
                io.to(room).emit('powerModeActivated');
            }
        }
    });

    // Ein Geist wurde eliminiert
    socket.on('ghostEliminated', ({ room, ghostId }) => {
         io.to(room).emit('ghostDied', { ghostId });
    });
    
    // Level beendet
    socket.on('levelFinished', ({ room }) => {
        if(rooms[room]) {
            rooms[room].level++;
            rooms[room].pelletsRemoved = [];
            rooms[room].crucifixesRemoved = [];
            io.to(room).emit('startNextLevel', { level: rooms[room].level });
        }
    });

    socket.on('disconnect', () => {
        // Suche Raum des Spielers
        for (const roomId in rooms) {
            if (rooms[roomId].players[socket.id]) {
                delete rooms[roomId].players[socket.id];
                io.to(roomId).emit('playerLeft', socket.id);

                // Wenn Host geht, neuen Host bestimmen
                if (rooms[roomId].hostId === socket.id) {
                    const remainingIds = Object.keys(rooms[roomId].players);
                    if (remainingIds.length > 0) {
                        rooms[roomId].hostId = remainingIds[0];
                        io.to(remainingIds[0]).emit('youAreHost'); 
                    } else {
                        delete rooms[roomId]; // Raum leer
                    }
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Toast the Ghost Server running on port ${PORT}`);
});


