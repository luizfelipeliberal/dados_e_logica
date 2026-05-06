import random
import time
import uuid

COLORS = ["azul", "marrom", "roxo", "vermelho"]

# azul e marrom vão de 2 até 12, roxo e vermelho de 12 até 2
ROW_NUMBERS = {
    "azul":     list(range(2, 13)),
    "marrom":   list(range(2, 13)),
    "roxo":     list(range(12, 1, -1)),
    "vermelho": list(range(12, 1, -1)),
}

SCORE_TABLE = [0, 1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66, 78]
PENALTY_POINTS = -5
MAX_PENALTIES = 4
MIN_MARKS_TO_LOCK = 5
TURN_DURATION = 80  # cada jogador tem 80 segundos por turno


def calc_score(marks: int) -> int:
    return SCORE_TABLE[marks]


class PlayerCard:
    def __init__(self):
        self.marks: dict[str, set] = {c: set() for c in COLORS}
        self.bonus_marks: dict[str, set] = {c: set() for c in COLORS}  # 'bonus_2', 'bonus_12'
        self.penalties: int = 0
        self.locked_rows: set = set()

    def can_mark_bonus(self, color: str, bonus_type: str) -> bool:
        if color in self.locked_rows:
            return False
        if bonus_type in self.bonus_marks[color]:
            return False
        return len(self.marks[color]) >= 5

    def mark_bonus(self, color: str, bonus_type: str) -> bool:
        if not self.can_mark_bonus(color, bonus_type):
            return False
        self.bonus_marks[color].add(bonus_type)
        return True

    def can_mark(self, color: str, number: int) -> bool:
        if color in self.locked_rows:
            return False
        row = ROW_NUMBERS[color]
        if number not in row:
            return False
        marked = self.marks[color]
        if number in marked:
            return False
        idx = row.index(number)
        already_marked_after = any(row.index(n) > idx for n in marked)
        if already_marked_after:
            return False
        if number == row[-1] and len(marked) < MIN_MARKS_TO_LOCK:
            return False
        return True

    def mark(self, color: str, number: int) -> bool:
        if not self.can_mark(color, number):
            return False
        self.marks[color].add(number)
        if number == ROW_NUMBERS[color][-1]:
            self.locked_rows.add(color)
        return True

    def unmark(self, color: str, number: int) -> bool:
        if number not in self.marks[color]:
            return False
        self.marks[color].discard(number)
        if color in self.locked_rows and ROW_NUMBERS[color][-1] not in self.marks[color]:
            self.locked_rows.discard(color)
        return True

    def add_penalty(self):
        self.penalties += 1

    def total_score(self) -> dict:
        scores = {}
        total = 0
        for color in COLORS:
            total_marks = len(self.marks[color]) + len(self.bonus_marks[color])
            pts = calc_score(total_marks)
            scores[color] = pts
            total += pts
        penalty_total = self.penalties * PENALTY_POINTS
        scores["penalties"] = penalty_total
        scores["total"] = total + penalty_total
        return scores

    def to_dict(self) -> dict:
        return {
            "marks": {c: sorted(list(v)) for c, v in self.marks.items()},
            "bonus_marks": {c: list(v) for c, v in self.bonus_marks.items()},
            "penalties": self.penalties,
            "locked_rows": list(self.locked_rows),
            "score": self.total_score(),
        }


class Game:
    def __init__(self, room_id: str):
        self.room_id = room_id
        self.players: dict[str, dict] = {}
        self.host_sid: str | None = None
        self.started: bool = False
        self.current_turn_sid: str | None = None
        self.turn_order: list[str] = []
        self.turn_index: int = 0
        self.dice: dict = {}
        self.locked_rows: set = set()
        # fases possíveis: lobby, rolling, choice, ended
        self.phase: str = "lobby"
        # rastreio da fase branca
        self.white_confirmed: set = set()
        self.white_marked: set = set()
        self.current_white_marks: dict = {}   # o que cada jogador marcou no branco
        # rastreio do jogador da vez
        self.active_turn_marked: bool = False
        self.color_phase_marked: bool = False
        self.current_color_mark: tuple | None = None  # (color, number)
        # Timer e prontos
        self.turn_start_time: float = 0.0
        self.ready_players: set = set()
        self.turn_count: int = 0  # incrementa a cada end_turn, nunca repete

    def add_player(self, sid: str, name: str):
        self.players[sid] = {"name": name, "card": PlayerCard()}
        if self.host_sid is None:
            self.host_sid = sid

    def remove_player(self, sid: str):
        self.players.pop(sid, None)
        self.white_confirmed.discard(sid)
        self.white_marked.discard(sid)
        if sid in self.turn_order:
            self.turn_order.remove(sid)
        if self.host_sid == sid and self.players:
            self.host_sid = next(iter(self.players))
        # se o jogador que saiu era o último que faltava confirmar, avança
        if self.phase == "white_phase" and self._all_white_confirmed():
            self.phase = "color_phase"

    def start(self) -> bool:
        if len(self.players) < 1:
            return False
        self.started = True
        self.turn_order = list(self.players.keys())
        self.turn_index = 0
        self.current_turn_sid = self.turn_order[0]
        self.phase = "rolling"
        return True

    def roll_dice(self) -> dict:
        white1 = random.randint(1, 6)
        white2 = random.randint(1, 6)
        colored = {c: random.randint(1, 6) for c in COLORS}
        self.dice = {
            "white1": white1,
            "white2": white2,
            "colored": colored,
            "white_sum": white1 + white2,
            "combos": {
                c: {
                    "white1": white1 + colored[c],
                    "white2": white2 + colored[c],
                }
                for c in COLORS
            },
        }
        self.phase = "choice"
        self.white_confirmed = set()
        self.white_marked = set()
        self.current_white_marks = {}
        self.active_turn_marked = False
        self.color_phase_marked = False
        self.current_color_mark = None
        self.turn_start_time = time.time()
        self.ready_players = set()
        return self.dice

    def _all_white_confirmed(self) -> bool:
        return set(self.players.keys()) <= self.white_confirmed

    def _mark_number(self, sid: str, color: str, number: int) -> dict:
        # valida e aplica a marcação, fechando a linha pra todo mundo se necessário
        if color in self.locked_rows:
            return {"ok": False, "error": "Linha já fechada globalmente"}
        card: PlayerCard = self.players[sid]["card"]
        ok = card.mark(color, number)
        if not ok:
            return {"ok": False, "error": "Marcação inválida nesta posição"}
        if color in card.locked_rows:
            self.locked_rows.add(color)
        return {"ok": True}

    # --- fase branca ---

    def mark_white(self, sid: str, color: str) -> dict:
        # qualquer jogador pode marcar a soma dos dados brancos em uma linha
        if self.phase != "choice":
            return {"ok": False, "error": "Não é a fase de escolha"}
        if sid in self.white_marked:
            return {"ok": False, "error": "Você já marcou nesta fase"}
        # quem já marcou a combinação colorida não pode mais marcar o branco
        if sid == self.current_turn_sid and self.color_phase_marked:
            return {"ok": False, "error": "Você já marcou a combinação colorida — o branco não pode mais ser marcado"}
        number = self.dice["white_sum"]
        result = self._mark_number(sid, color, number)
        if result["ok"]:
            self.white_marked.add(sid)
            self.current_white_marks[sid] = (color, number)
            if sid == self.current_turn_sid:
                self.active_turn_marked = True
        return result

    # --- fase colorida ---

    def mark_color(self, sid: str, color: str, white_die: str) -> dict:
        # só quem é da vez pode marcar, e apenas uma combinação por turno
        if self.phase != "choice":
            return {"ok": False, "error": "Não é a fase de escolha"}
        if sid != self.current_turn_sid:
            return {"ok": False, "error": "Apenas o jogador ativo pode marcar aqui"}
        if self.color_phase_marked:
            return {"ok": False, "error": "Você já marcou uma combinação nesta fase"}
        if white_die not in ("white1", "white2"):
            return {"ok": False, "error": "Dado branco inválido"}
        number = self.dice[white_die] + self.dice["colored"][color]
        result = self._mark_number(sid, color, number)
        if result["ok"]:
            self.active_turn_marked = True
            self.color_phase_marked = True
            self.current_color_mark = (color, number)
        return result

    # --- jogador pronto ---

    def player_ready(self, sid: str):
        self.ready_players.add(sid)

    # --- desfazer marcações ---

    def _recalc_locked_rows(self):
        self.locked_rows = set()
        for p in self.players.values():
            self.locked_rows |= p["card"].locked_rows

    def undo_white(self, sid: str) -> dict:
        if self.phase != "choice":
            return {"ok": False, "error": "Fora de fase"}
        if sid not in self.white_marked:
            return {"ok": False, "error": "Você não marcou o branco nesta rodada"}
        color, number = self.current_white_marks.pop(sid)
        self.players[sid]["card"].unmark(color, number)
        self.white_marked.discard(sid)
        self._recalc_locked_rows()
        if sid == self.current_turn_sid:
            self.active_turn_marked = self.color_phase_marked
        return {"ok": True}

    def undo_color(self, sid: str) -> dict:
        if self.phase != "choice":
            return {"ok": False, "error": "Fora de fase"}
        if sid != self.current_turn_sid:
            return {"ok": False, "error": "Apenas o jogador ativo pode desfazer a combinação"}
        if not self.color_phase_marked:
            return {"ok": False, "error": "Nenhuma combinação marcada para desfazer"}
        color, number = self.current_color_mark
        self.players[sid]["card"].unmark(color, number)
        self.color_phase_marked = False
        self.current_color_mark = None
        self._recalc_locked_rows()
        self.active_turn_marked = sid in self.white_marked
        return {"ok": True}

    # --- fim de turno ---

    def end_turn(self) -> tuple:
        self.turn_count += 1
        penalty_given = False
        if not self.active_turn_marked:
            self.players[self.current_turn_sid]["card"].add_penalty()
            penalty_given = True

        if self._check_end():
            self.phase = "ended"
            return True, penalty_given

        self.turn_index = (self.turn_index + 1) % len(self.turn_order)
        self.current_turn_sid = self.turn_order[self.turn_index]
        self.phase = "rolling"
        return False, penalty_given

    def _check_end(self) -> bool:
        if len(self.locked_rows) >= 2:
            return True
        for p in self.players.values():
            if p["card"].penalties >= MAX_PENALTIES:
                return True
        return False

    def state(self) -> dict:
        return {
            "room_id": self.room_id,
            "phase": self.phase,
            "started": self.started,
            "host": self.host_sid,
            "current_turn": self.current_turn_sid,
            "turn_order": self.turn_order,
            "locked_rows": list(self.locked_rows),
            "dice": self.dice,
            "white_confirmed": list(self.white_confirmed),
            "white_marked": list(self.white_marked),
            "active_turn_marked": self.active_turn_marked,
            "color_phase_marked": self.color_phase_marked,
            "turn_start_time": self.turn_start_time,
            "turn_duration": TURN_DURATION,
            "ready_players": list(self.ready_players),
            "players": {
                sid: {
                    "name": p["name"],
                    **p["card"].to_dict(),
                }
                for sid, p in self.players.items()
            },
        }


# salas ativas em memória
rooms: dict[str, Game] = {}


def create_room() -> str:
    room_id = str(uuid.uuid4())[:6].upper()
    rooms[room_id] = Game(room_id)
    return room_id


def get_room(room_id: str) -> Game | None:
    return rooms.get(room_id)
