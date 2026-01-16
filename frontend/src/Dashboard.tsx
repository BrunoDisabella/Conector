import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from './AuthContext';
import { QRCodeSVG } from 'qrcode.react';
import axios from 'axios';
import { LogOut, Key, Webhook, Smartphone, AlertCircle, Save } from 'lucide-react';
import { io, Socket } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

const Dashboard = () => {
    const { session, signOut } = useAuth();
    const [qr, setQr] = useState<string | null>(null);
    const [status, setStatus] = useState<'DISCONNECTED' | 'CONNECTED' | 'CONNECTING'>('CONNECTING');
    const [webhookUrl, setWebhookUrl] = useState('');
    const [webhookTrigger, setWebhookTrigger] = useState<'incoming' | 'outgoing' | 'both'>('incoming');
    const [apiKey, setApiKey] = useState('');
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [debugLog, setDebugLog] = useState<string[]>([]);
    const socketRef = useRef<Socket | null>(null);

    const addLog = (msg: string) => {
        console.log(msg);
        setDebugLog(prev => [msg, ...prev].slice(0, 10)); // Keep last 10 logs
    };

    useEffect(() => {
        if (!session) return;

        const fetchConfig = async () => {
            try {
                const res = await axios.get(`${API_URL}/session/config`, {
                    headers: { Authorization: `Bearer ${session.access_token}` }
                });
                if (res.data) {
                    setWebhookUrl(res.data.webhook_url || '');
                    setWebhookTrigger(res.data.webhook_trigger || 'incoming');
                    setApiKey(res.data.api_key || '');
                }
            } catch (e) {
                console.error("Failed to fetch config", e);
            }
        };

        fetchConfig();
        initSocket();

        // Trigger start session
        axios.post(`${API_URL}/session/start`, {}, {
            headers: { Authorization: `Bearer ${session.access_token}` }
        }).catch(err => console.error("Start session error:", err));

        return () => {
            if (socketRef.current) socketRef.current.disconnect();
        };
    }, [session]);

    const initSocket = () => {
        if (!session || socketRef.current) return;

        addLog(`Initializing Socket.IO to ${API_URL}...`);

        // Direct connection - No Proxy
        const socket = io(API_URL, {
            transports: ['websocket', 'polling'],
            autoConnect: true,
            reconnection: true,
            reconnectionAttempts: 10,
            path: '/socket.io' // Explicit path for Nginx compatibility
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            addLog(`Socket Connected! ID: ${socket.id}`);
            // Join Room with User ID
            addLog(`Joining room: ${session.user.id}`);
            socket.emit('join_room', session.user.id);
        });

        socket.on('connect_error', (err) => {
            addLog(`Socket Error: ${err.message} (${JSON.stringify(err)})`);
            console.error("Socket Connect Error:", err);
        });

        socket.on('qr', (data) => {
            addLog("QR Received via Socket!");
            setQr(data);
            setStatus('CONNECTING');
        });

        socket.on('ready', () => {
            addLog("Client Ready Event!");
            setStatus('CONNECTED');
            setQr(null);
        });

        socket.on('status', (data) => {
            addLog(`Status Update: ${data.status}`);
            if (data.status === 'CONNECTED') {
                setStatus('CONNECTED');
                setQr(null);
            }
        });

        socket.on('disconnected', () => {
            addLog("Socket Disconnected");
            setStatus('DISCONNECTED');
            setQr(null);
        });
    };

    // Fallback: Poll for QR every 2 seconds if not connected
    useEffect(() => {
        if (!session || status === 'CONNECTED') return;

        const interval = setInterval(async () => {
            try {
                const res = await axios.get(`${API_URL}/session/qr`, {
                    headers: { Authorization: `Bearer ${session.access_token}` }
                });
                if (res.data.qr) {
                    setQr(res.data.qr);
                    // Only log if we didn't have it before (avoid spam)
                    // addLog("QR Fetched via HTTP Polling"); 
                }
            } catch (e) {
                // Silent fail for polling
            }
        }, 2000);

        return () => clearInterval(interval);
    }, [session, status]);

    const saveWebhook = async () => {
        if (!session) return;
        setLoading(true);
        try {
            await axios.post(`${API_URL}/session/config/webhook`, {
                webhook_url: webhookUrl,
                webhook_trigger: webhookTrigger
            }, {
                headers: { Authorization: `Bearer ${session.access_token}` }
            });
            setMessage('Webhook guardado correctamente!');
            setTimeout(() => setMessage(null), 3000);
        } catch (e) {
            setMessage('Error al guardar webhook');
        } finally {
            setLoading(false);
        }
    };

    const saveApiKey = async () => {
        if (!session) return;
        if (apiKeyInput.length < 8) {
            setMessage('La API Key debe tener al menos 8 caracteres');
            setTimeout(() => setMessage(null), 3000);
            return;
        }

        setLoading(true);
        try {
            const res = await axios.post(`${API_URL}/session/config/apikey`, {
                api_key: apiKeyInput
            }, {
                headers: { Authorization: `Bearer ${session.access_token}` }
            });
            setApiKey(res.data.api_key);
            setApiKeyInput('');
            setMessage('API Key guardada correctamente!');
            setTimeout(() => setMessage(null), 3000);
        } catch (e: any) {
            setMessage(e.response?.data?.error || 'Error guardando API Key');
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = async () => {
        if (!session) return;
        if (!confirm('¿Cerrar sesión de WhatsApp? Tendrás que escanear de nuevo.')) return;

        try {
            await axios.post(`${API_URL}/session/logout`, {}, {
                headers: { Authorization: `Bearer ${session.access_token}` }
            });
            setQr(null);
            setStatus('DISCONNECTED');
            // Trigger start again to get new QR
            axios.post(`${API_URL}/session/start`, {}, {
                headers: { Authorization: `Bearer ${session.access_token}` }
            });
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white p-6">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <header className="flex justify-between items-center mb-10 bg-gray-800 p-4 rounded-xl shadow-lg border border-gray-700">
                    <div className="flex items-center gap-3">
                        <div className="bg-emerald-500 p-2 rounded-lg">
                            <Smartphone className="w-6 h-6 text-white" />
                        </div>
                        <h1 className="text-2xl font-bold">Conector Dashboard</h1>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-sm text-gray-400">
                            {session?.user.email}
                        </div>
                        <button
                            onClick={signOut}
                            className="bg-red-500/10 text-red-400 px-4 py-2 rounded-lg hover:bg-red-500/20 transition-colors flex items-center gap-2"
                        >
                            <LogOut className="w-4 h-4" /> Salir
                        </button>
                    </div>
                </header>

                {/* Message Toast */}
                {message && (
                    <div className="fixed top-4 right-4 bg-emerald-600 text-white px-6 py-3 rounded-lg shadow-lg z-50">
                        {message}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Connection Status & QR */}
                    <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-xl">
                        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                            {status === 'CONNECTED' ? <span className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></span> : <span className="w-3 h-3 bg-yellow-500 rounded-full"></span>}
                            Estado de Conexión
                        </h2>

                        <div className="flex flex-col items-center justify-center min-h-[300px] bg-gray-900/50 rounded-xl border border-gray-700/50 p-8">
                            {status === 'CONNECTED' ? (
                                <div className="text-center">
                                    <div className="w-24 h-24 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <Smartphone className="w-12 h-12 text-emerald-400" />
                                    </div>
                                    <h3 className="text-2xl font-bold text-emerald-400 mb-2">WhatsApp Conectado</h3>
                                    <p className="text-gray-400 mb-6">Tu sesión está activa y funcionando.</p>
                                    <button
                                        onClick={handleLogout}
                                        className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg transition-colors"
                                    >
                                        Desconectar WhatsApp
                                    </button>
                                </div>
                            ) : (
                                <div className="text-center">
                                    {qr ? (
                                        <div className="bg-white p-4 rounded-xl shadow-lg mb-4">
                                            <QRCodeSVG value={qr} size={200} />
                                        </div>
                                    ) : (
                                        <div className="animate-spin w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full mb-4"></div>
                                    )}
                                    <p className="text-gray-400">
                                        {qr ? 'Escanea el código QR para conectar' : 'Esperando QR...'}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Configuration */}
                    <div className="space-y-8">
                        {/* API Key Config */}
                        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-xl">
                            <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                                <Key className="w-5 h-5 text-purple-400" />
                                API Key
                            </h2>
                            <div className="space-y-4">
                                {apiKey && (
                                    <div>
                                        <label className="block text-sm text-gray-400 mb-2">Tu API Key Actual</label>
                                        <input
                                            type="text"
                                            value={apiKey}
                                            readOnly
                                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-gray-300 font-mono text-sm"
                                        />
                                    </div>
                                )}
                                <div>
                                    <label className="block text-sm text-gray-400 mb-2">Crear/Cambiar API Key</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={apiKeyInput}
                                            onChange={(e) => setApiKeyInput(e.target.value)}
                                            placeholder="Escribe tu clave personalizada (mín. 8 caracteres)"
                                            className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-purple-500 outline-none"
                                        />
                                        <button
                                            onClick={saveApiKey}
                                            disabled={loading || apiKeyInput.length < 8}
                                            className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
                                        >
                                            <Save className="w-4 h-4" />
                                            Guardar
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                                        <AlertCircle className="w-3 h-3" />
                                        Úsala en el header <code className="bg-gray-700 px-1 rounded">x-api-key</code> para tus peticiones.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Webhook Config */}
                        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 shadow-xl">
                            <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
                                <Webhook className="w-5 h-5 text-blue-400" />
                                Webhook Config
                            </h2>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm text-gray-400 mb-2">URL del Webhook (POST)</label>
                                    <input
                                        type="text"
                                        value={webhookUrl}
                                        onChange={(e) => setWebhookUrl(e.target.value)}
                                        placeholder="https://tu-endpoint.com/webhook"
                                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm text-gray-400 mb-2">Activar Webhook en:</label>
                                    <div className="flex gap-3 flex-wrap">
                                        <label className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer border ${webhookTrigger === 'incoming' ? 'bg-blue-600 border-blue-500' : 'bg-gray-900 border-gray-700'}`}>
                                            <input
                                                type="radio"
                                                name="trigger"
                                                value="incoming"
                                                checked={webhookTrigger === 'incoming'}
                                                onChange={() => setWebhookTrigger('incoming')}
                                                className="hidden"
                                            />
                                            📥 Mensajes Entrantes
                                        </label>
                                        <label className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer border ${webhookTrigger === 'outgoing' ? 'bg-blue-600 border-blue-500' : 'bg-gray-900 border-gray-700'}`}>
                                            <input
                                                type="radio"
                                                name="trigger"
                                                value="outgoing"
                                                checked={webhookTrigger === 'outgoing'}
                                                onChange={() => setWebhookTrigger('outgoing')}
                                                className="hidden"
                                            />
                                            📤 Mensajes Salientes
                                        </label>
                                        <label className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer border ${webhookTrigger === 'both' ? 'bg-blue-600 border-blue-500' : 'bg-gray-900 border-gray-700'}`}>
                                            <input
                                                type="radio"
                                                name="trigger"
                                                value="both"
                                                checked={webhookTrigger === 'both'}
                                                onChange={() => setWebhookTrigger('both')}
                                                className="hidden"
                                            />
                                            🔄 Ambos
                                        </label>
                                    </div>
                                </div>

                                <button
                                    onClick={saveWebhook}
                                    disabled={loading}
                                    className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
                                >
                                    <Save className="w-4 h-4" />
                                    Guardar Configuración de Webhook
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Debug Log */}
                <div className="mt-8 bg-black/50 p-4 rounded-xl font-mono text-xs text-green-400 border border-gray-800">
                    <h3 className="text-gray-500 mb-2">Debug Logs:</h3>
                    {debugLog.map((log, i) => (
                        <div key={i}>{log}</div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
