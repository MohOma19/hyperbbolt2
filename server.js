require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 3000; // Railway sets PORT automatically

const HB_API_KEY = process.env.HB_API_KEY;
if (!HB_API_KEY) {
    console.error('HB_API_KEY environment variable is required.');
    process.exit(1);
}

// CORS and security headers — must be registered before all routes
app.use((req, res, next) => {
    // Allow cross-origin requests (required for the Hyperbeam SDK loaded from unpkg.com)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');

    // Content Security Policy:
    //   script-src  — allow inline scripts and the Hyperbeam SDK from unpkg.com
    //   frame-src   — allow Hyperbeam session iframes from *.hyperbeam.com
    //   connect-src — allow fetch/XHR and WebSocket (wss://) to the Hyperbeam engine API
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://unpkg.com",
            "frame-src https://*.hyperbeam.com",
            "connect-src 'self' https://engine.hyperbeam.com https://*.hyperbeam.com wss://*.hyperbeam.com",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "media-src 'self' https://*.hyperbeam.com",
            "worker-src blob:"
        ].join('; ')
    );

    // Handle pre-flight OPTIONS requests immediately
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    next();
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/get-browser-session', async (req, res) => {
    try {
        const response = await fetch("https://engine.hyperbeam.com/v0/vm", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${HB_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({})
        });

        const raw = await response.text();
        console.log("Hyperbeam raw response:", raw);

        if (!response.ok) {
            console.error("Hyperbeam API error", response.status, raw);
            return res.status(500).json({
                message: "Hyperbeam API error",
                status: response.status,
                body: raw
            });
        }

        let data;
        try {
            data = raw ? JSON.parse(raw) : {};
        } catch (parseErr) {
            return res.status(500).json({
                message: "Failed to parse Hyperbeam response as JSON",
                body: raw
            });
        }

        console.log("Hyperbeam response:", data);
        res.json(data);

    } catch (err) {
        console.error("Fetch error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/get-active-sessions', async (req, res) => {
    try {
        const response = await fetch("https://engine.hyperbeam.com/v0/vm", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${HB_API_KEY}`,
                "Content-Type": "application/json"
            }
        });

        const raw = await response.text();
        let data;
        try {
            data = raw ? JSON.parse(raw) : {};
        } catch (parseErr) {
            return res.status(500).json({
                message: "Failed to parse response",
                body: raw
            });
        }

        if (!response.ok) {
            return res.status(response.status).json({
                message: "Hyperbeam active sessions error",
                body: data
            });
        }

        res.json(data);
    } catch (err) {
        console.error("Fetch error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/close-all-sessions', async (req, res) => {
    console.log('Received request to close all sessions');
    try {
        const listResponse = await fetch("https://engine.hyperbeam.com/v0/vm", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${HB_API_KEY}`,
                "Content-Type": "application/json"
            }
        });

        const listRaw = await listResponse.text();
        let listData;
        try {
            listData = listRaw ? JSON.parse(listRaw) : {};
        } catch (parseErr) {
            return res.status(500).json({
                message: "Failed to parse sessions list",
                body: listRaw
            });
        }

        if (!listResponse.ok) {
            return res.status(listResponse.status).json({
                message: "Hyperbeam error",
                body: listData
            });
        }

        const sessions = Array.isArray(listData)
            ? listData
            : Array.isArray(listData.results)
                ? listData.results
                : Array.isArray(listData.sessions)
                    ? listData.sessions
                    : [];

        if (sessions.length === 0) {
            return res.json({ message: "No active sessions found", closed: [] });
        }

        const deleteResults = await Promise.all(sessions.map(async (session) => {
            const sessionId = session.session_id || session.id || session.sessionId;
            if (!sessionId) {
                return { session, success: false, error: "Missing session_id" };
            }

            const deleteResponse = await fetch(`https://engine.hyperbeam.com/v0/vm/${sessionId}`, {
                method: "DELETE",
                headers: {
                    "Authorization": `Bearer ${HB_API_KEY}`,
                    "Content-Type": "application/json"
                }
            });

            const deleteRaw = await deleteResponse.text();
            let deleteData;
            try {
                deleteData = deleteRaw ? JSON.parse(deleteRaw) : {};
            } catch {
                deleteData = { raw: deleteRaw };
            }

            return {
                session_id: sessionId,
                status: deleteResponse.status,
                body: deleteData,
                success: deleteResponse.ok
            };
        }));

        res.json({ message: "Close-all-sessions completed", results: deleteResults });
    } catch (err) {
        console.error("Fetch error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
