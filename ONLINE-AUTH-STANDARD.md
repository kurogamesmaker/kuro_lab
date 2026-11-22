# KUROGames Online Authentication Standard

## Rule
Every KUROGames online feature requires a signed-in KURO account backed by Supabase Auth. No game may create or accept an anonymous/guest identity for online use.

## Scope
Account required: online multiplayer, creating/joining/listing rooms, real-time events, online rankings (including reads and submissions), cloud saves, profile access, and online settings.

Account not required: game launch, offline play, CPU play, local progress, and local-only settings.

## Shared flow
1. Game and Studio preview obtain the current Supabase Auth session from the KUROGames parent page.
2. The KuroGames ONLINE SDK supplies that access token to `kurogames-online`.
3. The Edge Function calls `admin.auth.getUser` and rejects anonymous Auth accounts and non-Supabase tokens.
4. The Cloudflare Worker independently checks the same account token and room membership before issuing a `kuro_account` WebSocket ticket.

## UI
When an unsigned-in player attempts an online action, show a login prompt with a link to the shared KURO account page. Do not block offline gameplay. The player can complete login in another tab and retry without restarting the game.

## Forbidden patterns
- Supabase `signInAnonymously` for online play
- Cloudflare `/guest-token` issuance or `/guest/verify` acceptance
- Game-specific guest tokens or game-specific auth systems
- Trusting client-supplied user IDs instead of the verified Supabase account

## Compatibility
`get_config` may be read before login so a game can discover enabled features. All player-specific online data and actions require a real signed-in account. Historical guest room rows are retained until normal room expiry; they cannot authenticate or rejoin.
