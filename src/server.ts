import express, { NextFunction } from 'express';
import { Request, Response } from 'express';
import http from 'http';
import bodyParser from 'body-parser';
import { CallbackInvoke, callbacks, pending } from 'config/secret.one';
// import * as socketIO from 'socket.io';
// import { getConfig } from './config/config.js';

// MAIN APPS
const app = express();
const server = http.createServer(app);
// const io = socketIO(server);

// CONFIG MIDDLEWARE
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use((err: any, _req: Request, res: Response, _next:NextFunction) => {
    console.error(err.stack);
    res.status(500).send('Internal Server Error');
  });

// SETUP SOCKET CONNECTIONS
// io.on('connection', (socket) => {
//     console.log('A client connected');
//     // Handle disconnect event
//     socket.on('disconnect', () => {
//         console.log('A client disconnected');
//     });
// });


app.post('/api-handshake', async (req: Request, res: Response) => {
    res.sendStatus(200).end();
    const { id, payload } = req.body;
    if(!id || !payload) return;
    if(!pending.has(id)) return;
    if(callbacks.has(id)) return;
    await CallbackInvoke(id, payload);
});


const PORT = process.env.PORT || 6000;

server.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});


export function init() {
    // this is used to hotload scripts into the main process
    console.log("Load server");
}
