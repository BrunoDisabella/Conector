import { Router } from 'express';
import { clientManager } from '../index';
import { MessageMedia } from 'whatsapp-web.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const router = Router();
const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

// Middleware to check API Key
const apiKeyAuth = async (req: any, res: any, next: any) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: 'Missing API Key' });

    const { data, error } = await supabase
        .from('user_configs')
        .select('user_id')
        .eq('api_key', apiKey)
        .single();

    if (error || !data) return res.status(403).json({ error: 'Invalid API Key' });

    req.userId = data.user_id; // Attach userId to request
    next();
};

// Send Message
router.post('/send-message', apiKeyAuth, async (req: any, res: any) => {
    const { userId } = req;
    const { number, message, mediaUrl, mediaBase64, mediaType } = req.body;

    if (!number) return res.status(400).json({ error: 'Number is required' });

    const client = clientManager.getClient(userId);
    if (!client) return res.status(503).json({ error: 'Session not active' });

    try {
        let sentMessage;
        const chatId = number.includes('@c.us') ? number : `${number}@c.us`;

        if (mediaBase64) {
            // Send Media (Image/Audio/Doc)
            const media = new MessageMedia(mediaType || 'image/png', mediaBase64);
            sentMessage = await client.sendMessage(chatId, media, { caption: message });
        } else if (mediaUrl) {
            const media = await MessageMedia.fromUrl(mediaUrl);
            sentMessage = await client.sendMessage(chatId, media, { caption: message });
        } else {
            // Send Text
            sentMessage = await client.sendMessage(chatId, message || '');
        }

        res.json({ success: true, id: sentMessage.id._serialized });
    } catch (error: any) {
        console.error('Send message failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// Check Status
router.get('/status', apiKeyAuth, async (req: any, res: any) => {
    const { userId } = req;
    const client = clientManager.getClient(userId);

    if (!client) return res.json({ status: 'DISCONNECTED', reason: 'No active session' });

    try {
        const state = await client.getState();
        res.json({ status: 'CONNECTED', state });
    } catch (e) {
        res.json({ status: 'DISCONNECTED', error: String(e) });
    }
});

export default router;
