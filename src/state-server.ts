import * as http from 'http';

/**
 * RuneLite state received from the HTTP endpoint
 */
export type RuneLiteState = {
	player?: {
		name: string;
		world: number;
	};
	stats?: {
		hp?: {
			current: number;
			max: number;
			status?: 'poisoned' | 'venomed' | 'diseased' | 'poisoned_diseased' | 'venomed_diseased';
		};
		prayer?: {
			current: number;
			max: number;
		};
		runEnergy?: number;
		runEnabled?: boolean;
		specialAttack?: number;
		specialAttackEnabled?: boolean;
		specialAttackAvailable?: boolean;
	};
	activePrayers?: string[];
	activeTab?: string;
};

/**
 * Callback type for state change listeners
 */
type StateListener = (state: RuneLiteState) => void;

/**
 * Global state storage
 */
let currentState: RuneLiteState = {};

/**
 * Registered state change listeners
 */
const listeners: Set<StateListener> = new Set();

/**
 * HTTP server instance
 */
let server: http.Server | null = null;

/**
 * Current server port
 */
let currentPort = 8085;

/**
 * Gets the current RuneLite state
 */
export function getState(): RuneLiteState {
	return currentState;
}

/**
 * Registers a listener for state changes
 */
export function addStateListener(listener: StateListener): void {
	listeners.add(listener);
}

/**
 * Removes a state change listener
 */
export function removeStateListener(listener: StateListener): void {
	listeners.delete(listener);
}

/**
 * Notifies all listeners of a state change
 */
function notifyListeners(): void {
	for (const listener of listeners) {
		try {
			listener(currentState);
		} catch (error) {
			console.error('[StateServer] Error in listener:', error);
		}
	}
}

/**
 * Starts the HTTP server to receive state from RuneLite
 */
export function startServer(port: number = 8085): void {
	if (server) {
		console.log('[StateServer] Server already running');
		return;
	}

	currentPort = port;

	server = http.createServer((req, res) => {
		// Set CORS headers
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

		// Handle preflight
		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		// Only accept POST to /state
		if (req.method === 'POST' && req.url === '/state') {
			let body = '';

			req.on('data', chunk => {
				body += chunk.toString();
			});

			req.on('end', () => {
				try {
					const newState = JSON.parse(body) as RuneLiteState;
					currentState = newState;
					console.log('[StateServer] Received state update:', JSON.stringify(newState));
					notifyListeners();
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ success: true }));
				} catch (error) {
					console.error('[StateServer] Error parsing state:', error);
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'Invalid JSON' }));
				}
			});
		} else {
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Not found' }));
		}
	});

	server.listen(port, () => {
		console.log(`[StateServer] HTTP server listening on port ${port}`);
	});

	server.on('error', (error: NodeJS.ErrnoException) => {
		console.error('[StateServer] Server error:', error);
		if (error.code === 'EADDRINUSE') {
			console.log(`[StateServer] Port ${port} is in use, trying ${port + 1}`);
			server = null;
			startServer(port + 1);
		}
	});
}

/**
 * Stops the HTTP server
 */
export function stopServer(): void {
	if (server) {
		server.close();
		server = null;
		console.log('[StateServer] Server stopped');
	}
}

/**
 * Gets the current server port
 */
export function getServerPort(): number {
	return currentPort;
}
