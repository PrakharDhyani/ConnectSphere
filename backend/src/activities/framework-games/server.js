/**
 * The four framework games as plugins — chess · uno · typing · bingo.
 *
 * ONE FILE, FOUR GAMES, NO GAME LOGIC.
 *
 * The migration plan calls these "near-mechanical" because they are already
 * thin configs over `sockets/lobbyGame.js`, which §1.2 identifies as an SDK in
 * its own right: *"The plugin contract should extend it, not replace it."*
 * Taking that literally, each game costs one line here — `adaptLobbyGame`
 * translates between the framework's callbacks and the plugin host, and the
 * games themselves are not touched at all.
 *
 * The alternative — four separate server modules — would have duplicated the
 * seat, bot and timer handling four times, and charged every future lobby game
 * the same tax. That is precisely the N×M coupling the plugin system exists to
 * remove, so re-introducing it inside the plugin system would have been an odd
 * way to finish the job.
 *
 * The games keep their legacy registration until the flag names them, so both
 * paths serve the SAME framework instance and therefore the same table. There
 * is never a second copy of a game in flight — only a second way to reach it.
 */
import { adaptLobbyGame } from "../lobbyGameAdapter.js";
import { chess } from "../../sockets/chess.handlers.js";
import { uno } from "../../sockets/uno.handlers.js";
import { typing } from "../../sockets/typing.handlers.js";
import { bingo } from "../../sockets/bingo.handlers.js";

export const chessServer = adaptLobbyGame("chess", chess, chess.cfg);
export const unoServer = adaptLobbyGame("uno", uno, uno.cfg);
export const typingServer = adaptLobbyGame("typing", typing, typing.cfg);
export const bingoServer = adaptLobbyGame("bingo", bingo, bingo.cfg);
