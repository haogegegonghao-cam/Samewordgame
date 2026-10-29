-- Optional: run periodically in the SQL Editor as the project owner.
-- Room lifetime is 24h. Deleting a room cascades to all private guesses.
delete from public.game_rooms where expires_at < now();
-- Supabase Auth has no automatic anonymous-user cleanup. Keep recently active
-- identities; run the following only if you accept resetting old anonymous logins.
-- delete from auth.users where is_anonymous = true
--   and greatest(created_at,coalesce(last_sign_in_at,created_at)) < now()-interval '30 days';
