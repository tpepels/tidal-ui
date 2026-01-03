import { handler } from '../../build/handler.js';
import { createServer } from 'https';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '../..');

const server = createServer(
	{
		cert: readFileSync(join(rootDir, '.certs/cert.pem')),
		key: readFileSync(join(rootDir, '.certs/key.pem'))
	},
	handler
);

server.listen(5000, () => {
	console.log('Server running on https://localhost:5000');
});
