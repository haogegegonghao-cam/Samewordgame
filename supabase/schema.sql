-- 同词相遇 · Run once in a new Supabase project's SQL Editor.
-- The browser can SELECT only sanitized member rooms; ALL mutations use RPC.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.game_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid not null,
  guest_id uuid,
  phase text not null default 'waiting' check (phase in ('waiting','thinking','reveal','won','closed')),
  game integer not null default 1,
  round integer not null default 1 check (round between 1 and 50),
  submitted_a boolean not null default false,
  submitted_b boolean not null default false,
  ready_a boolean not null default false,
  ready_b boolean not null default false,
  history jsonb not null default '[]',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  seen_a timestamptz not null default now(),
  seen_b timestamptz,
  revision integer not null default 0,
  check (host_id is distinct from guest_id)
);
create index on public.game_rooms(host_id);
create index on public.game_rooms(expires_at);
alter table public.game_rooms enable row level security;
revoke all on public.game_rooms from public, anon, authenticated;
grant select on public.game_rooms to authenticated;
create policy member_read on public.game_rooms for select to authenticated
  using ((auth.uid() = host_id or auth.uid() = guest_id) and expires_at > now());

create table private.game_guesses (
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  game integer not null,
  round integer not null,
  player_id uuid not null,
  word text not null,
  primary key (room_id,game,round,player_id)
);
alter table private.game_guesses enable row level security;
revoke all on private.game_guesses from public, anon, authenticated;

-- Exact same whitespace set and NFKC policy as src/words.js. Case is preserved.
create function private.clean_word(value text) returns text
language sql immutable strict set search_path = '' as $$
  select btrim(regexp_replace(normalize(value, NFKC),
    U&'[\0009-\000D\0020\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000]+', ' ', 'g'));
$$;

create function private.snapshot(r public.game_rooms) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'code', r.code, 'phase', r.phase, 'game', r.game, 'round', r.round,
    'seat', case when auth.uid() = r.host_id then 'a' else 'b' end,
    'joined', r.guest_id is not null,
    'submitted', jsonb_build_object('a',r.submitted_a,'b',r.submitted_b),
    'ready', jsonb_build_object('a',r.ready_a,'b',r.ready_b),
    'history',r.history,'revision',r.revision,'expiresAt',r.expires_at,
    'online',jsonb_build_object('a',r.seen_a > now()-interval '55 seconds',
                              'b',coalesce(r.seen_b > now()-interval '55 seconds',false))
  );
$$;

-- Membership and expiry guard. All mutating RPCs lock this row for their transaction.
create function private.lock_room(p_room uuid) returns public.game_rooms
language plpgsql security definer set search_path = '' as $$
declare r public.game_rooms;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into r from public.game_rooms where id=p_room for update;
  if not found or (auth.uid() <> r.host_id and auth.uid() is distinct from r.guest_id)
    then raise exception 'NOT_MEMBER'; end if;
  if r.expires_at <= now() then raise exception 'ROOM_UNAVAILABLE'; end if;
  return r;
end;
$$;

create function public.game_create() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.game_rooms; uid uuid := auth.uid(); room_code text;
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  -- Resume an existing open room after a lost create response.
  select * into r from public.game_rooms where host_id=uid and phase<>'closed'
    and expires_at>now() order by created_at desc limit 1;
  if found then return private.snapshot(r); end if;
  if (select count(*) from public.game_rooms where host_id=uid and created_at>now()-interval '1 hour') >= 12
    then raise exception 'TOO_MANY_ROOMS'; end if;
  loop
    -- 50 bits of randomness; no enumerable room listing, no short numeric IDs.
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
      (get_byte(bytes,n) % 32)+1,1),'') into room_code
      from (select uuid_send(gen_random_uuid()) as bytes) s, generate_series(0,9) n;
    begin
      insert into public.game_rooms(code,host_id) values(room_code,uid) returning * into r;
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  return private.snapshot(r);
end;
$$;

create function public.game_join(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.game_rooms; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into r from public.game_rooms where code=upper(regexp_replace(p_code,'[ -]','','g')) for update;
  if not found or r.expires_at<=now() then raise exception 'ROOM_UNAVAILABLE'; end if;
  if r.phase='closed' then raise exception 'ROOM_CLOSED'; end if;
  if uid=r.host_id or uid=r.guest_id then return private.snapshot(r); end if;
  if r.guest_id is not null then raise exception 'ROOM_FULL'; end if;
  update public.game_rooms set guest_id=uid,phase='thinking',seen_b=now(),revision=revision+1
    where id=r.id returning * into r;
  return private.snapshot(r);
end;
$$;

create function public.game_sync(p_room uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.game_rooms;
begin
  r := private.lock_room(p_room);
  -- Poll is also presence heartbeat. Only touch DB every 20s per player.
  if auth.uid()=r.host_id and r.seen_a<now()-interval '20 seconds' then
    update public.game_rooms set seen_a=now() where id=p_room returning * into r;
  elsif auth.uid()=r.guest_id and (r.seen_b is null or r.seen_b<now()-interval '20 seconds') then
    update public.game_rooms set seen_b=now() where id=p_room returning * into r;
  end if;
  return private.snapshot(r);
end;
$$;

create function public.game_submit(p_room uuid,p_game integer,p_round integer,p_word text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.game_rooms; w text; existing text; wa text; wb text; is_host boolean;
begin
  r := private.lock_room(p_room);
  if r.phase='closed' then raise exception 'ROOM_CLOSED'; end if;
  if r.game<>p_game or r.round<>p_round then raise exception 'STALE_TURN'; end if;
  w := private.clean_word(p_word);
  if w is null or char_length(w) not between 1 and 24 or w ~ U&'[\0001-\0008\000E-\001F\007F-\009F\200B-\200F\202A-\202E\2060-\206F\FEFF]'
    then raise exception 'INVALID_WORD'; end if;
  select word into existing from private.game_guesses where room_id=p_room and game=p_game
    and round=p_round and player_id=auth.uid();
  if found then
    if existing<>w then raise exception 'ALREADY_SUBMITTED'; end if;
    return private.snapshot(r); -- Exact retries are idempotent, including after reveal.
  end if;
  if r.phase<>'thinking' then raise exception 'WRONG_PHASE'; end if;
  insert into private.game_guesses values(p_room,p_game,p_round,auth.uid(),w);
  is_host := auth.uid()=r.host_id;
  update public.game_rooms set submitted_a=submitted_a or is_host,submitted_b=submitted_b or not is_host,
    revision=revision+1 where id=p_room returning * into r;
  if r.submitted_a and r.submitted_b then
    select word into wa from private.game_guesses where room_id=p_room and game=p_game and round=p_round and player_id=r.host_id;
    select word into wb from private.game_guesses where room_id=p_room and game=p_game and round=p_round and player_id=r.guest_id;
    update public.game_rooms set phase=case when wa=wb then 'won' else 'reveal' end,
      history=history || jsonb_build_array(jsonb_build_object('round',p_round,'a',wa,'b',wb,'match',wa=wb)),
      revision=revision+1 where id=p_room returning * into r;
  end if;
  return private.snapshot(r);
end;
$$;

create function public.game_advance(p_room uuid,p_game integer,p_round integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.game_rooms; is_host boolean;
begin
  r := private.lock_room(p_room);
  -- Stale acknowledgements can never advance the new turn.
  if r.game<>p_game or r.round<>p_round then return private.snapshot(r); end if;
  if r.phase<>'reveal' or r.round>=50 then raise exception 'WRONG_PHASE'; end if;
  is_host := auth.uid()=r.host_id;
  update public.game_rooms set ready_a=ready_a or is_host,ready_b=ready_b or not is_host,
    revision=revision+1 where id=p_room returning * into r;
  if r.ready_a and r.ready_b then
    update public.game_rooms set round=round+1,phase='thinking',submitted_a=false,submitted_b=false,
      ready_a=false,ready_b=false,revision=revision+1 where id=p_room returning * into r;
  end if;
  return private.snapshot(r);
end;
$$;

create function public.game_restart(p_room uuid,p_game integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.game_rooms; is_host boolean;
begin
  r := private.lock_room(p_room);
  if r.game<>p_game then return private.snapshot(r); end if;
  if r.phase<>'won' and not (r.phase='reveal' and r.round=50) then raise exception 'WRONG_PHASE'; end if;
  is_host := auth.uid()=r.host_id;
  update public.game_rooms set ready_a=ready_a or is_host,ready_b=ready_b or not is_host,
    revision=revision+1 where id=p_room returning * into r;
  if r.ready_a and r.ready_b then
    delete from private.game_guesses where room_id=p_room;
    update public.game_rooms set game=game+1,round=1,phase='thinking',submitted_a=false,submitted_b=false,
      ready_a=false,ready_b=false,history='[]',revision=revision+1 where id=p_room returning * into r;
  end if;
  return private.snapshot(r);
end;
$$;

create function public.game_leave(p_room uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.game_rooms;
begin
  r := private.lock_room(p_room);
  -- Do not reopen an abandoned seat: no stranger can inherit a player's history.
  delete from private.game_guesses where room_id=p_room;
  update public.game_rooms set phase='closed',revision=revision+1 where id=p_room returning * into r;
  return private.snapshot(r);
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.game_create(), public.game_join(text), public.game_sync(uuid),
  public.game_submit(uuid,integer,integer,text), public.game_advance(uuid,integer,integer),
  public.game_restart(uuid,integer), public.game_leave(uuid) from public, anon, authenticated;
grant execute on function public.game_create(), public.game_join(text), public.game_sync(uuid),
  public.game_submit(uuid,integer,integer,text), public.game_advance(uuid,integer,integer),
  public.game_restart(uuid,integer), public.game_leave(uuid) to authenticated;

-- Publish only the sanitized room table, NEVER private.game_guesses.
do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.game_rooms;
  end if;
end $$;
commit;
