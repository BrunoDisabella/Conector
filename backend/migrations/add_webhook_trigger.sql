-- Add webhook_trigger column to user_configs
ALTER TABLE user_configs 
ADD COLUMN IF NOT EXISTS webhook_trigger TEXT DEFAULT 'incoming';

-- Values can be: 'incoming', 'outgoing', 'both'
