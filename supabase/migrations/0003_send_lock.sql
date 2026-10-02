-- Confirm & Send lock: set while a Resend call is in flight, so status only becomes
-- 'confirmed_sent' after Resend accepts the email, and a double click still can't send twice.
alter table candidates add column if not exists send_started_at timestamptz;
notify pgrst, 'reload schema';
