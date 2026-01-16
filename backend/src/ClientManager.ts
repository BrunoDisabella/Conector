import { Client, LocalAuth } from 'whatsapp-web.js';
import fs from 'fs-extra';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import dotenv from 'dotenv';
import { Server } from 'socket.io'; // Import Config

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export class ClientManager {
  private clients: Map<string, Client> = new Map();
  private lastQr: Map<string, string> = new Map(); // Store latest QR for polling
  private authDir: string;
  private io: Server;

  constructor(io: Server) {
    this.authDir = path.join(process.cwd(), '.wwebjs_auth');
    this.io = io;
  }

  public async init() {
    console.log('Initializing ClientManager...');
    await fs.ensureDir(this.authDir);

    try {
      const items = await fs.readdir(this.authDir);
      for (const item of items) {
        if (item.startsWith('session-')) {
          const userId = item.replace('session-', '');
          console.log(`Found persisted session for: ${userId}, restoring...`);
          // Don't auto-start immediately to save resources or do it if required.
          // For now, we restore.
          this.startClient(userId);
        }
      }
    } catch (err) {
      console.error('Error restoring sessions:', err);
    }
  }

  public getClient(userId: string): Client | undefined {
    return this.clients.get(userId);
  }

  public getQr(userId: string): string | undefined {
    return this.lastQr.get(userId);
  }

  // Socket Helper
  private emitToUser(userId: string, event: string, data: any) {
    this.io.to(userId).emit(event, data);
  }

  public async startClient(userId: string) {
    // If client exists, check if it's ready. If so, emit ready.
    if (this.clients.has(userId)) {
      const existing = this.clients.get(userId);
      // We can check connection state here ideally, but for now assumption:
      this.emitToUser(userId, 'status', { status: 'CONNECTED' });
      return existing;
    }

    console.log(`Starting client for ${userId}`);
    this.emitToUser(userId, 'status', { status: 'INITIALIZING' });

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: userId,
        dataPath: this.authDir
      }),
      puppeteer: {
        headless: true,
        handleSIGINT: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      }
    });

    client.on('qr', (qr) => {
      console.log(`QR received for ${userId}`);
      this.lastQr.set(userId, qr); // Save for polling
      this.emitToUser(userId, 'qr', qr);
    });

    client.on('ready', () => {
      console.log(`Client ${userId} is ready!`);
      this.lastQr.delete(userId); // Clear QR on success
      this.emitToUser(userId, 'ready', {});
      this.emitToUser(userId, 'status', { status: 'CONNECTED' });
    });

    client.on('auth_failure', (msg) => {
      console.error(`Auth failure for ${userId}: `, msg);
      this.emitToUser(userId, 'error', { message: 'Auth failure' });
    });

    client.on('message', async (message) => {
      await this.dispatchWebhook(userId, message);
    });

    client.on('disconnected', (reason) => {
      console.log(`Client ${userId} disconnected: ${reason} `);
      this.emitToUser(userId, 'disconnected', { reason });
      this.clients.delete(userId);
    });

    this.clients.set(userId, client);

    try {
      await client.initialize();
    } catch (error) {
      console.error(`Failed to initialize client for ${userId}`, error);
      this.emitToUser(userId, 'error', { message: 'Failed to initialize' });
    }

    return client;
  }

  public async deleteSession(userId: string) {
    const client = this.clients.get(userId);
    if (client) {
      try {
        await client.logout();
      } catch (e) { console.warn("Logout failed", e); }
      try {
        await client.destroy();
      } catch (e) { console.warn("Destroy failed", e); }
      this.clients.delete(userId);
    }

    const sessionDir = path.join(this.authDir, `session-${userId}`);
    if (await fs.pathExists(sessionDir)) {
      // WhatsApp Web JS sometimes locks files, retry or ignore errors if possible
      try {
        await fs.remove(sessionDir);
        console.log(`Session files deleted for ${userId}`);
      } catch (e) {
        console.error("Could not delete session files", e);
      }
    }
    this.emitToUser(userId, 'disconnected', { reason: 'logout' });
  }

  private async dispatchWebhook(userId: string, message: any) {
    try {
      const { data, error } = await supabase
        .from('user_configs')
        .select('webhook_url, webhook_trigger')
        .eq('user_id', userId)
        .single();

      if (error || !data || !data.webhook_url) return;

      const trigger = data.webhook_trigger || 'incoming';
      const isOutgoing = message.fromMe;

      // Filter based on trigger
      if (trigger === 'incoming' && isOutgoing) return;
      if (trigger === 'outgoing' && !isOutgoing) return;
      // 'both' passes everything

      const payload = {
        from: message.from,
        to: message.to,
        body: message.body,
        type: message.type,
        timestamp: message.timestamp,
        notifyName: message._data?.notifyName || '',
        hasMedia: message.hasMedia,
        isGroup: message.from.includes('@g.us'),
        id: message.id._serialized,
        fromMe: message.fromMe
      };

      console.log(`Sending webhook to ${data.webhook_url} for ${userId}`);
      await axios.post(data.webhook_url, payload);

    } catch (err) {
      console.error(`Error sending webhook for ${userId}`, err);
    }
  }
}
