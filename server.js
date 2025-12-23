import { handler } from './build/handler.js';
import { createServer } from 'https';
import { readFileSync } from 'fs';

const server = createServer(
	{
		cert: readFileSync('./cert.pem'),
		key: readFileSync('./key.pem')
	},
	handler
);

server.listen(5000, () => {
	console.log('Server running on https://localhost:5000');
});
