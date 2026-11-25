-- Allow the server-verified Prime Breaker session type.
-- The verifier already uses game_type = 'prime_factor' for prime_start,
-- prime_answer, prime_skip, and prime_finish.
alter table public.game_verification_sessions
  drop constraint if exists game_verification_sessions_game_type_check;

alter table public.game_verification_sessions
  add constraint game_verification_sessions_game_type_check
  check (game_type = any (array[
    'number_guess'::text,
    'tictactoe'::text,
    'prime_factor'::text
  ]));
