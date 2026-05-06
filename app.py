from flask import Flask, render_template, request
from flask_socketio import SocketIO, join_room, leave_room, emit
from game import create_room, get_room, rooms, ROW_NUMBERS, TURN_DURATION

app = Flask(__name__)
app.config["SECRET_KEY"] = "dados-e-logica-secret"
socketio = SocketIO(app, cors_allowed_origins="*")

player_rooms: dict[str, str] = {}


def auto_end_background(room_id: str, expected_turn_count: int):
    socketio.sleep(TURN_DURATION)
    game = get_room(room_id)
    if not game or game.turn_count != expected_turn_count or game.phase != "choice":
        return
    sid = game.current_turn_sid
    name = game.players.get(sid, {}).get("name", "?")
    ended, penalty = game.end_turn()
    socketio.emit("game_state", game.state(), to=room_id)
    socketio.emit("message", f"⏰ Tempo esgotado! Turno de {name} encerrado.", to=room_id)
    if penalty:
        socketio.emit("message", f"{name} não marcou nada — penalidade!", to=room_id)
    if ended:
        socketio.emit("message", "Jogo encerrado!", to=room_id)
    else:
        next_name = game.players.get(game.current_turn_sid, {}).get("name", "?")
        socketio.emit("message", f"Vez de {next_name} rolar os dados!", to=room_id)


@app.route("/")
def index():
    return render_template("index.html")


# --- desconexão ---

@socketio.on("disconnect")
def on_disconnect():
    sid = request.sid
    room_id = player_rooms.pop(sid, None)
    if not room_id:
        return
    game = get_room(room_id)
    if not game:
        return
    player_name = game.players.get(sid, {}).get("name", "?")
    game.remove_player(sid)
    leave_room(room_id)
    if not game.players:
        rooms.pop(room_id, None)
    else:
        emit("game_state", game.state(), to=room_id)
        emit("message", f"{player_name} saiu da sala.", to=room_id)


# --- lobby ---

@socketio.on("create_room")
def on_create_room(data):
    name = data.get("name", "Jogador").strip() or "Jogador"
    room_id = create_room()
    game = get_room(room_id)
    game.add_player(request.sid, name)
    player_rooms[request.sid] = room_id
    join_room(room_id)
    emit("room_created", {"room_id": room_id})
    emit("game_state", game.state(), to=room_id)


@socketio.on("join_room_event")
def on_join_room(data):
    name = data.get("name", "Jogador").strip() or "Jogador"
    room_id = data.get("room_id", "").strip().upper()
    game = get_room(room_id)
    if not game:
        emit("error", {"msg": "Sala não encontrada."})
        return
    if game.started:
        emit("error", {"msg": "O jogo já começou."})
        return
    game.add_player(request.sid, name)
    player_rooms[request.sid] = room_id
    join_room(room_id)
    emit("game_state", game.state(), to=room_id)
    emit("message", f"{name} entrou na sala!", to=room_id)


@socketio.on("start_game")
def on_start_game():
    sid = request.sid
    room_id = player_rooms.get(sid)
    game = get_room(room_id)
    if not game or game.host_sid != sid:
        emit("error", {"msg": "Apenas o host pode iniciar."})
        return
    if not game.start():
        emit("error", {"msg": "Precisa de pelo menos 1 jogador."})
        return
    emit("game_state", game.state(), to=room_id)
    emit("message", "O jogo começou!", to=room_id)


# --- rolagem dos dados ---

@socketio.on("roll_dice")
def on_roll_dice():
    sid = request.sid
    room_id = player_rooms.get(sid)
    game = get_room(room_id)
    if not game or not game.started:
        return
    if game.current_turn_sid != sid:
        emit("error", {"msg": "Não é sua vez de rolar."})
        return
    if game.phase != "rolling":
        emit("error", {"msg": "Não é hora de rolar os dados."})
        return
    game.roll_dice()
    name = game.players[sid]["name"]
    emit("game_state", game.state(), to=room_id)
    emit("message", f"{name} rolou os dados!", to=room_id)
    socketio.start_background_task(auto_end_background, room_id, game.turn_count)


# --- fase branca (todos podem marcar) ---

@socketio.on("mark_white")
def on_mark_white(data):
    sid = request.sid
    room_id = player_rooms.get(sid)
    game = get_room(room_id)
    if not game or not game.started or game.phase != "choice":
        return
    color = data.get("color")
    if color not in ROW_NUMBERS:
        emit("error", {"msg": "Cor inválida."})
        return
    result = game.mark_white(sid, color)
    if not result["ok"]:
        emit("error", {"msg": result["error"]})
        return
    emit("game_state", game.state(), to=room_id)


# --- fase colorida (só quem é da vez) ---

@socketio.on("mark_color")
def on_mark_color(data):
    sid = request.sid
    room_id = player_rooms.get(sid)
    game = get_room(room_id)
    if not game or not game.started or game.phase != "choice":
        return
    if game.current_turn_sid != sid:
        emit("error", {"msg": "Apenas o jogador ativo pode marcar aqui."})
        return
    color = data.get("color")
    white_die = data.get("white_die")
    if color not in ROW_NUMBERS:
        emit("error", {"msg": "Cor inválida."})
        return
    result = game.mark_color(sid, color, white_die)
    if not result["ok"]:
        emit("error", {"msg": result["error"]})
        return
    emit("game_state", game.state(), to=room_id)


# --- bônus do 2 e do 12 ---

@socketio.on("mark_bonus")
def on_mark_bonus(data):
    sid = request.sid
    room_id = player_rooms.get(sid)
    game = get_room(room_id)
    if not game or not game.started or game.phase != "choice":
        return
    color = data.get("color")
    bonus_type = data.get("bonus_type")
    if color not in ROW_NUMBERS or bonus_type not in ("bonus_2", "bonus_12"):
        emit("error", {"msg": "Dados inválidos."})
        return
    card = game.players[sid]["card"]
    if not card.mark_bonus(color, bonus_type):
        emit("error", {"msg": "Precisa de 5 marcações na linha para usar o bônus."})
        return
    if sid == game.current_turn_sid:
        game.active_turn_marked = True
    emit("game_state", game.state(), to=room_id)


# --- desfazer ---

@socketio.on("undo_white")
def on_undo_white():
    sid = request.sid
    room_id = player_rooms.get(sid)
    game = get_room(room_id)
    if not game or not game.started:
        return
    result = game.undo_white(sid)
    if not result["ok"]:
        emit("error", {"msg": result["error"]})
        return
    emit("game_state", game.state(), to=room_id)


@socketio.on("undo_color")
def on_undo_color():
    sid = request.sid
    room_id = player_rooms.get(sid)
    game = get_room(room_id)
    if not game or not game.started:
        return
    result = game.undo_color(sid)
    if not result["ok"]:
        emit("error", {"msg": result["error"]})
        return
    emit("game_state", game.state(), to=room_id)


# --- jogador pronto ---

@socketio.on("player_ready")
def on_player_ready():
    sid = request.sid
    room_id = player_rooms.get(sid)
    game = get_room(room_id)
    if not game or not game.started or game.phase != "choice":
        return
    game.player_ready(sid)
    emit("game_state", game.state(), to=room_id)


# --- encerrar turno ---

@socketio.on("end_turn")
def on_end_turn():
    sid = request.sid
    room_id = player_rooms.get(sid)
    game = get_room(room_id)
    if not game or not game.started or game.phase != "choice":
        return
    if game.current_turn_sid != sid:
        emit("error", {"msg": "Não é sua vez."})
        return
    ended, penalty_given = game.end_turn()
    emit("game_state", game.state(), to=room_id)
    if penalty_given:
        emit("message", f"{game.players.get(sid, {}).get('name', '?')} não marcou nada — penalidade!", to=room_id)
    if ended:
        emit("message", "Jogo encerrado!", to=room_id)
    else:
        next_name = game.players[game.current_turn_sid]["name"]
        emit("message", f"Vez de {next_name} rolar os dados!", to=room_id)


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, debug=False, host="0.0.0.0", port=port)
