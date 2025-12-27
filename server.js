const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = {};

io.on('connection', (socket) => {
    console.log('Verbindung:', socket.id);

    socket.on('joinRoom', ({ room, character, username }) => {
        socket.join(room);

        if (!rooms[room]) {
            rooms[room] = {
                players: {},
                ghosts: [],
                pelletsRemoved: [],
                crucifixesRemoved: [],
                hostId: socket.id,
                level: 1,
                score: 0,
                isTransitioning: false // NEU: Sperre für Levelwechsel
            };
        }

        rooms[room].players[socket.id] = {
            id: socket.id,
            x: 0, z: 0, rotation: 0,
            character: character,
            username: username,
            isDead: false
        };

        socket.emit('currentRoomState', rooms[room]);
        socket.to(room).emit('playerJoined', rooms[room].players[socket.id]);
    });

    socket.on('playerMove', ({ room, x, z, rotation }) => {
        if (rooms[room] && rooms[room].players[socket.id]) {
            rooms[room].players[socket.id].x = x;
            rooms[room].players[socket.id].z = z;
            rooms[room].players[socket.id].rotation = rotation;
            socket.to(room).emit('playerMoved', { id: socket.id, x, z, rotation });
        }
    });

    socket.on('ghostsUpdate', ({ room, ghostsData }) => {
        if (rooms[room]) {
            rooms[room].ghosts = ghostsData;
            socket.to(room).emit('ghostsUpdated', ghostsData);
        }
    });

    socket.on('itemCollected', ({ room, type, index }) => {
        if (!rooms[room] || rooms[room].isTransitioning) return; // Keine Items während Wechsel sammeln
        
        let updateNeeded = false;
        if (type === 'pellet') {
            if (!rooms[room].pelletsRemoved.includes(index)) {
                rooms[room].pelletsRemoved.push(index);
                rooms[room].score += 10;
                updateNeeded = true;
            }
        } else if (type === 'crucifix') {
             if (!rooms[room].crucifixesRemoved.includes(index)) {
                rooms[room].crucifixesRemoved.push(index);
                rooms[room].score += 50;
                updateNeeded = true;
                io.to(room).emit('powerModeActivated');
            }
        }

        if(updateNeeded) {
            io.to(room).emit('itemRemoved', { type, index, newScore: rooms[room].score });
        }
    });

    socket.on('ghostEliminated', ({ room, ghostId }) => {
         if(rooms[room] && !rooms[room].isTransitioning) {
             rooms[room].score += 500;
             io.to(room).emit('ghostDied', { ghostId, newScore: rooms[room].score });
         }
    });

    socket.on('playerKilled', ({ room, playerId }) => {
        if (rooms[room] && rooms[room].players[playerId] && !rooms[room].isTransitioning) {
            if(!rooms[room].players[playerId].isDead) {
                rooms[room].players[playerId].isDead = true;
                io.to(room).emit('playerDied', { playerId });

                const allDead = Object.values(rooms[room].players).every(p => p.isDead);
                if (allDead) {
                    io.to(room).emit('gameOver', { finalScore: rooms[room].score });
                    // Soft Reset
                    rooms[room].isTransitioning = false; 
                    rooms[room].level = 1;
                    rooms[room].score = 0;
                    rooms[room].pelletsRemoved = [];
                    rooms[room].crucifixesRemoved = [];
                    for(let pid in rooms[room].players) rooms[room].players[pid].isDead = false;
                }
            }
        }
    });
    
    // --- NEU: Sicherer Levelwechsel ---
    socket.on('levelFinished', ({ room }) => {
        if(rooms[room] && !rooms[room].isTransitioning) {
            console.log(`Room ${room} finished Level ${rooms[room].level}`);
            rooms[room].isTransitioning = true; // Sperre aktivieren
            
            // Level erhöhen
            rooms[room].level++;
            rooms[room].pelletsRemoved = [];
            rooms[room].crucifixesRemoved = [];
            
            // Alle heilen
            for(let pid in rooms[room].players) {
                rooms[room].players[pid].isDead = false;
            }

            // Signal an alle senden
            io.to(room).emit('startNextLevel', { level: rooms[room].level });

            // Sperre nach kurzer Zeit aufheben (damit Clients laden können)
            setTimeout(() => {
                if(rooms[room]) rooms[room].isTransitioning = false;
            }, 2000);
        }
    });

    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            if (rooms[roomId].players[socket.id]) {
                delete rooms[roomId].players[socket.id];
                io.to(roomId).emit('playerLeft', socket.id);
                if (rooms[roomId].hostId === socket.id) {
                    const remainingIds = Object.keys(rooms[roomId].players);
                    if (remainingIds.length > 0) {
                        rooms[roomId].hostId = remainingIds[0];
                        io.to(remainingIds[0]).emit('youAreHost'); 
                    } else {
                        delete rooms[roomId]; 
                    }
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});


