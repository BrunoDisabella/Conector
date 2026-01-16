import { Router } from 'express';
import { clientManager } from '../index';
import { createClient } from '@supabase/supabase-js';

const router = Router();
const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

// Middleware to verify Supabase JWT (for Frontend usage)
const supabaseAuth = async (req: any, res: any, next: any) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Missing token' });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(403).json({ error: 'Invalid token' });

    req.user = user;
    next();
};

// HTTP Polling Route for QR (Fallback)
router.get('/qr', supabaseAuth, async (req: any, res: any) => {
    const userId = req.user.id;
    const qr = clientManager.getQr(userId);
    res.json({ qr });
});

// Start Session (Triggered via API, updates via Socket)
router.post('/start', supabaseAuth, async (req: any, res: any) => {
    const userId = req.user.id;
    // Just trigger the start. The client will emit 'qr' or 'ready' events via socket.
    try {
        clientManager.startClient(userId);
        res.json({ success: true, message: 'Client initializing...' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/logout', supabaseAuth, async (req: any, res: any) => {
    const userId = req.user.id;
    await clientManager.deleteSession(userId);
    res.json({ success: true });
});

// Config Management
router.get('/config', supabaseAuth, async (req: any, res: any) => {
    const { data, error } = await supabase
        .from('user_configs')
        .select('*')
        .eq('user_id', req.user.id)
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// Save Webhook URL + Trigger Options
router.post('/config/webhook', supabaseAuth, async (req: any, res: any) => {
    const { webhook_url, webhook_trigger } = req.body;

    const { error } = await supabase
        .from('user_configs')
        .upsert({
            user_id: req.user.id,
            webhook_url,
            webhook_trigger: webhook_trigger || 'incoming'
        });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// Save CUSTOM API Key
router.post('/config/apikey', supabaseAuth, async (req: any, res: any) => {
    const { api_key } = req.body;

    if (!api_key || api_key.length < 8) {
        return res.status(400).json({ error: 'API Key must be at least 8 characters' });
    }

    const { error } = await supabase
        .from('user_configs')
        .upsert({ user_id: req.user.id, api_key });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ api_key });
});

export default router;
